const mineflayer = require('mineflayer');
const { Rcon } = require('rcon-client');
const y = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const args = y(hideBin(process.argv))
  .option('host', { type: 'string', demandOption: true })
  .option('port', { type: 'number', default: 25565 })
  .option('bots-per-node', { type: 'number', default: 100 })
  .option('teleport_interval', { type: 'number', default: 1 })
  .option('range', { type: 'number', default: 2000 })
  .option('fill_size', { type: 'number', default: 96 })
  .option('fill_height', { type: 'number', default: 5 })
  .option('fills_per_interval', { type: 'number', default: 8 })
  .option('flush_every', { type: 'number', default: 0 }) // 0 = disabled
  .option('cmds_per_sec', { type: 'number', default: 30 })
  .option('forceload', { type: 'boolean', default: false })
  .option('forceload_remove_after', { type: 'number', default: 10 }) // seconds; 0=manual rotate
  .option('forceload_cap_chunks', { type: 'number', default: 128 })
  .option('rcon_port', { type: 'number', default: 25575 })
  .option('rcon_password', { type: 'string', default: 'password' })
  .option('builders-per-node', { type: 'number', default: 0 })
  .option('op_via', { type: 'string', default: 'console' })
  .argv;

function nowIso(){ return new Date().toISOString(); }
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function alignTo(x,m){ return Math.floor(x/m)*m; }
function chunkCoord(n){ return Math.floor(n/16); }

// metrics
const stats = { connected_ok:0, connected_err:0, rcon_ok:0, rcon_err:0 };

console.log('[start]', nowIso(), JSON.stringify({
  host: args.host, port: Number(args.port),
  bots: Number(args['bots-per-node']),
  tp_interval_s: Number(args.teleport_interval),
  range: Number(args.range),
  fill_size: Number(args.fill_size),
  fill_height: Number(args.fill_height),
  fills_per_interval: Number(args.fills_per_interval),
  flush_every: Number(args.flush_every),
  cmds_per_sec: Number(args.cmds_per_sec),
  mode: 'RCON-console (no OP required)',
  forceload: !!args.forceload,
  flush_leader: process.env.FLUSH_LEADER === '1'
}));

class RconQueue {
  constructor(opts, maxRate){
    this.opts=opts; this.q=[]; this.busy=false; this.conn=null; this.backoff=0;
    this.sendDelay = Math.max(5, Math.floor(1000 / Math.max(1, maxRate)));
  }
  async ensureConn(){
    if (this.conn) return this.conn;
    this.conn = await Rcon.connect({ ...this.opts, timeout: 4000 });
    this.conn.on('end', ()=>{ this.conn=null; });
    return this.conn;
  }
  push(cmd, tag=''){
    return new Promise((resolve,reject)=>{
      this.q.push({cmd,tag,resolve,reject});
      this.pump();
    });
  }
  async pump(){
    if (this.busy || !this.q.length) return;
    this.busy = true;
    if (this.backoff>0) await new Promise(r=>setTimeout(r,this.backoff));
    const it = this.q.shift();
    try{
      const c = await this.ensureConn();
      const out = await c.send(it.cmd);
      stats.rcon_ok++;
      this.backoff = 0;
      it.resolve(out);
      setTimeout(()=>{ this.busy=false; this.pump(); }, this.sendDelay);
    }catch(e){
      stats.rcon_err++;
      console.log('[rcon-error]', nowIso(), it.tag||it.cmd, e.message || e);
      try { this.conn?.end(); } catch {}
      this.conn = null;
      this.backoff = Math.min(this.backoff ? this.backoff*2 : 500, 5000);
      it.reject(e);
      setTimeout(()=>{ this.busy=false; this.pump(); }, this.backoff);
    }
  }
}

const RC = new RconQueue(
  { host: args.host, port: Number(args.rcon_port), password: args.rcon_password },
  Number(args.cmds_per_sec)
);

const bots = new Map();
const RUN = Math.random().toString(36).slice(2,8);
function uname(i){ return `diskbot${RUN}${i.toString(36)}`; }

function startBot(i){
  const username = uname(i);
  const bot = mineflayer.createBot({ host: args.host, port: Number(args.port), username, auth: 'offline' });

  bot.once('spawn', () => { stats.connected_ok++; console.log('[spawn]', nowIso(), username); });
  bot.on('kicked', (r)=>{ stats.connected_err++; console.log('[kicked]', nowIso(), username, r); });
  bot.on('error',  (e)=>{ stats.connected_err++; console.log('[error]',  nowIso(), username, e.message); });
  bot.on('end',    ()=>{ bots.delete(username); setTimeout(()=>startBot(i), 5000); });

  bots.set(username, bot);
}
for (let i=0;i<Number(args['bots-per-node']);i++) setTimeout(()=>startBot(i), i*50);

const size = Math.max(8, Math.min(Number(args.fill_size||96), 96));
const h    = Math.max(1, Math.min(Number(args.fill_height||5), 8));
const fillsCap = Math.max(1, Math.min(Number(args.fills_per_interval||8), 12));

let lastFL = null; // {cminX,cminZ,cmaxX,cmaxZ}
function sameRect(a,b){
  if (!a || !b) return false;
  return a.cminX===b.cminX && a.cminZ===b.cminZ && a.cmaxX===b.cmaxX && a.cmaxZ===b.cmaxZ;
}
function clampRectToCap(rect, cap){
  let {cminX,cminZ,cmaxX,cmaxZ} = rect;
  const area = ()=> (cmaxX-cminX+1)*(cmaxZ-cminZ+1);
  while (area() > cap && (cmaxX>cminX || cmaxZ>cminZ)){
    if ((cmaxX-cminX) >= (cmaxZ-cminZ)) { if (cmaxX>cminX) cmaxX--; if (area()<=cap) break; if (cminX<cmaxX) cminX++; }
    else { if (cmaxZ>cminZ) cmaxZ--; if (area()<=cap) break; if (cminZ<cmaxZ) cminZ++; }
  }
  return { cminX, cminZ, cmaxX, cmaxZ };
}
function queueForceloadForBatch(xzRects){
  if (!args.forceload || !xzRects.length) return null;
  let minX=Infinity, minZ=Infinity, maxX=-Infinity, maxZ=-Infinity;
  for (const r of xzRects){
    if (r.x1<minX) minX=r.x1; if (r.z1<minZ) minZ=r.z1;
    if (r.x2>maxX) maxX=r.x2; if (r.z2>maxZ) maxZ=r.z2;
  }
  let rect = {
    cminX: chunkCoord(minX), cminZ: chunkCoord(minZ),
    cmaxX: chunkCoord(maxX), cmaxZ: chunkCoord(maxZ)
  };
  rect = clampRectToCap(rect, Math.max(1, Number(args.forceload_cap_chunks||128)));
  if (!sameRect(rect, lastFL)) {
    const removeAfter = Number(args.forceload_remove_after || 0);
    // Remove previous window immediately if we’re not using delayed removal
    if (lastFL && removeAfter === 0) {
      RC.push(`forceload remove ${lastFL.cminX} ${lastFL.cminZ} ${lastFL.cmaxX} ${lastFL.cmaxZ}`, 'forceload-rem').catch(()=>{});
    }
    RC.push(`forceload add ${rect.cminX} ${rect.cminZ} ${rect.cmaxX} ${rect.cmaxZ}`, 'forceload-add').catch(()=>{});
    lastFL = rect;
    if (removeAfter > 0) {
      setTimeout(() =>
        RC.push(`forceload remove ${rect.cminX} ${rect.cminZ} ${rect.cmaxX} ${rect.cmaxZ}`, 'forceload-rem').catch(()=>{}),
        removeAfter * 1000
      );
    }
  }
  return rect;
}

const offsets = [
  [0,0],[16,0],[0,16],[16,16],[-16,0],[0,-16],
  [32,0],[0,32],[48,0],[0,48],[-32,0],[0,-32]
];
let blockToggle=false;
const blocks=['stone','dirt'];

setInterval(() => {
  const names = [...bots.keys()];
  if (!names.length) return;

  const who = names[randInt(0, names.length-1)];
  const rawX = randInt(-args.range, args.range);
  const rawZ = randInt(-args.range, args.range);
  const x0 = alignTo(rawX, 16), z0 = alignTo(rawZ, 16);
  const y = 64;

  const kMax = Math.min(fillsCap, offsets.length);
  const rects = [];
  for (let k=0;k<kMax;k++){
    const [ox,oz] = offsets[k];
    const x1 = x0+ox, z1 = z0+oz;
    const x2 = x1 + (size-1);
    const z2 = z1 + (size-1);
    const y1 = y - Math.floor(h/2);
    const y2 = y1 + h - 1;
    rects.push({x1,z1,x2,z2,y1,y2});
  }

  queueForceloadForBatch(rects);          // optional, bounded
  RC.push(`tp ${who} ${x0+8} ${y} ${z0+8}`, 'tp').catch(()=>{});

  for (const r of rects){
    const block = blocks[blockToggle?0:1]; blockToggle = !blockToggle;
    RC.push(`fill ${r.x1} ${r.y1} ${r.z1} ${r.x2} ${r.y2} ${r.z2} ${block} replace`, 'fill').catch(()=>{});
  }
}, Math.max(200, Number(args.teleport_interval||1)*1000));


if (Number(args.flush_every || 0) > 0 && process.env.FLUSH_LEADER === '1') {
  setInterval(()=>{ RC.push('save-all flush', 'flush').catch(()=>{}); }, Number(args.flush_every)*1000);
}

setInterval(()=>console.log('[stats]', nowIso(), JSON.stringify({ ...stats, bots: bots.size })), 10000);

function cleanup(){
  if (args.forceload){
    RC.push('forceload remove all', 'forceload-clear').catch(()=>{});
  }
  setTimeout(()=>{ try { process.exit(0); } catch {} }, 250);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

