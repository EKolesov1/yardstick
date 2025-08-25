const { Rcon } = require('rcon-client');
const y = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const args = y(hideBin(process.argv))
  .option('host', { type: 'string', demandOption: true })
  .option('rcon_port', { type: 'number', default: 25575 })
  .option('rcon_password', { type: 'string', default: 'password' })

  // Work pacing
  .option('batch_interval', { type: 'number', default: 2 }) // seconds
  .option('cmds_per_sec',   { type: 'number', default: 12 })
  .option('rcon_reply_timeout_ms', { type: 'number', default: 2000 })

  // Geometry (anchored)
  .option('center_x', { type: 'number', default: 0 })
  .option('center_z', { type: 'number', default: 0 })
  .option('jitter',   { type: 'number', default: 0 })
  .option('fill_size', { type: 'number', default: 48 })
  .option('fill_height', { type: 'number', default: 3 })
  .option('fills_per_batch', { type: 'number', default: 3 })

  // Forceload window (in chunks)
  .option('forceload_chunks_x', { type: 'number', default: 12 })
  .option('forceload_chunks_z', { type: 'number', default: 12 })
  .option('forceload', { type: 'boolean', default: true })

  // Flushing
  .option('flush_every', { type: 'number', default: 0 }) // seconds; 0 = never
  .option('flush_leader', { type: 'boolean', default: false })

  // Debug
  .option('echo_replies', { type: 'boolean', default: true }) // log a few replies
  .argv;

function now(){ return new Date().toISOString(); }
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function align16(n){ return Math.floor(n/16)*16; }
const chunk = n => Math.floor(n/16);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

console.log('[start]', now(), JSON.stringify({
  host: args.host,
  mode: 'RCON-ONLY (anchored)',
  center: [args.center_x, args.center_z],
  jitter: args.jitter,
  batch_interval: args.batch_interval,
  fill_size: args.fill_size,
  fill_height: args.fill_height,
  fills_per_batch: args.fills_per_batch,
  forceload: args.forceload,
  forceload_chunks: [args.forceload_chunks_x, args.forceload_chunks_z],
  flush_every: args.flush_every,
  flush_leader: args.flush_leader,
  cmds_per_sec: args.cmds_per_sec,
  rcon_reply_timeout_ms: args.rcon_reply_timeout_ms,
  echo_replies: args.echo_replies
}));

// --------------------- RCON queue with reply timeout ---------------------
class RQ {
  constructor(opts, rate, replyTimeoutMs, echo){
    this.opts = opts;
    this.q = [];
    this.busy = false;
    this.conn = null;
    this.backoff = 0;
    this.replyTimeoutMs = Math.max(200, Number(replyTimeoutMs)||2000);
    this.delay = Math.max(5, Math.floor(1000 / Math.max(1, rate)));
    this.stats = { ok:0, timeouts:0, err:0 };
    this.echo = !!echo;
    this.echoBudget = 20; // don't spam; log first few replies
  }
  async _conn(){
    if (this.conn) return this.conn;
    this.conn = await Rcon.connect({ ...this.opts, timeout: 4000 });
    this.conn.on('end', ()=>{ this.conn = null; });
    return this.conn;
  }
  push(cmd, tag=''){
    return new Promise((res,rej)=>{ this.q.push({cmd,tag,res,rej}); this._pump(); });
  }
  async _pump(){
    if (this.busy || !this.q.length) return;
    this.busy = true;

    if (this.backoff) await sleep(this.backoff);
    const it = this.q.shift();

    try{
      const c = await this._conn();
      const out = await Promise.race([
        c.send(it.cmd),
        new Promise((_, rej)=>setTimeout(()=>rej(new Error('rcon-send-timeout')), this.replyTimeoutMs))
      ]);

      this.stats.ok++;
      if (this.echo && this.echoBudget > 0) {
        console.log('[rcon-ok]', now(), it.tag || it.cmd, (String(out||'').trim()).slice(0,120));
        this.echoBudget--;
      }
      this.backoff = 0;
      it.res(out);
      setTimeout(()=>{ this.busy=false; this._pump(); }, this.delay);

    }catch(e){
      if (e && e.message === 'rcon-send-timeout') {
        this.stats.timeouts++;
        if (this.echo && this.echoBudget > 0) {
          console.log('[rcon-timeout]', now(), it.tag || it.cmd);
          this.echoBudget--;
        }
        it.res('timeout-ignored');
        setTimeout(()=>{ this.busy=false; this._pump(); }, this.delay);
        return;
      }
      this.stats.err++;
      console.log('[rcon-err]', now(), it.tag || it.cmd, e.message || e);
      try{ this.conn?.end(); }catch{}
      this.conn = null;
      this.backoff = Math.min(this.backoff ? this.backoff*2 : 500, 5000);
      it.rej(e);
      setTimeout(()=>{ this.busy=false; this._pump(); }, this.backoff);
    }
  }
}

const RC = new RQ(
  { host: args.host, port: Number(args.rcon_port), password: args.rcon_password },
  Number(args.cmds_per_sec),
  Number(args.rcon_reply_timeout_ms),
  Boolean(args.echo_replies)
);

// --------------------- anchored forceload window ---------------------
async function setPersistentForceload(){
  if (!args.forceload) return;
  const halfX = Math.max(1, Math.floor(Number(args.forceload_chunks_x)/2));
  const halfZ = Math.max(1, Math.floor(Number(args.forceload_chunks_z)/2));
  const cx = chunk(args.center_x), cz = chunk(args.center_z);
  const cminX = cx - halfX, cmaxX = cx + halfX - 1;
  const cminZ = cz - halfZ, cmaxZ = cz + halfZ - 1;
  console.log('[forceload-plan]', now(), { cminX, cminZ, cmaxX, cmaxZ });
  RC.push(`forceload add ${cminX} ${cminZ} ${cmaxX} ${cmaxZ}`, 'forceload-add').catch(()=>{});
}

const OFFS = [[0,0],[16,0],[0,16],[16,16],[-16,0],[0,-16],[32,0],[0,32]];
let toggle=false;
const blocks = ['stone','dirt'];

function pickOrigin(){
  const jx = randInt(-args.jitter, args.jitter);
  const jz = randInt(-args.jitter, args.jitter);
  return [align16(args.center_x + jx), align16(args.center_z + jz)];
}

async function doBatch(){
  const [x0,z0] = pickOrigin();
  const y = 64;
  const size = clamp(Number(args.fill_size), 16, 96);
  const h    = clamp(Number(args.fill_height), 1, 5);
  const k    = clamp(Number(args.fills_per_batch), 1, OFFS.length);

  for (let i=0;i<k;i++){
    const [ox,oz] = OFFS[i];
    const x1 = x0+ox, z1 = z0+oz;
    const x2 = x1 + (size-1);
    const z2 = z1 + (size-1);
    const y1 = y - Math.floor(h/2);
    const y2 = y1 + h - 1;
    const block = blocks[toggle?0:1]; toggle = !toggle;
    RC.push(`fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block} replace`, 'fill').catch(()=>{});
  }
}

async function enableFeedback(){
  // Ensure we actually SEE command results in logs on older builds
  RC.push('gamerule sendCommandFeedback true', 'gamerule-scfs').catch(()=>{});
  // Some older versions: also try to turn on logging of admin command output (ignore errors if unknown)
  RC.push('gamerule logAdminCommands true', 'gamerule-logadmin').catch(()=>{});
  // quick probe
  RC.push('say DiskLoad RCON up', 'probe-say').catch(()=>{});
}

// --------------------- main ---------------------
(async function main(){
  await enableFeedback();
  await setPersistentForceload();

  // Short grace; even if replies are missing, commands are enqueued
  await sleep(1000);

  setInterval(()=>{ doBatch().catch(()=>{}); }, Math.max(250, Number(args.batch_interval)*1000));

  if (Number(args.flush_every)>0 && args.flush_leader){
    setInterval(()=>RC.push('save-all flush','flush').catch(()=>{}), Math.max(1, Number(args.flush_every))*1000);
  }

  setInterval(()=>{
    console.log('[stats]', now(), JSON.stringify({
      qlen: RC.q.length,
      rcon_ok: RC.stats.ok,
      rcon_timeouts: RC.stats.timeouts,
      rcon_err: RC.stats.err
    }));
  }, 10000);

  function bye(){
    if (args.forceload){ RC.push('forceload remove all','forceload-clear').catch(()=>{}); }
    setTimeout(()=>process.exit(0), 250);
  }
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
})();