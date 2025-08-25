const { fork } = require('child_process');
const { hideBin } = require('yargs/helpers');
const { Rcon } = require('rcon-client');

const argv = require('yargs')(hideBin(process.argv))
  .option('host', { type: 'string', demandOption: true })
  .option('port', { type: 'number', default: 25565 })
  .option('bots-per-node', { type: 'number', default: 20 })
  .option('range', { type: 'number', default: 800 })
  .option('goal_interval', { type: 'number', default: 20 })
  .option('build_interval', { type: 'number', default: 7 })
  .option('mine_interval', { type: 'number', default: 11 })
  .option('flush_every', { type: 'number', default: 60 })
  .option('rcon_port', { type: 'number', default: 25575 })
  .option('rcon_password', { type: 'string', default: 'password' })

  .option('teleport_interval', { type: 'number', default: 1 })
  .option('fill_size', { type: 'number', default: 96 })
  .option('fill_height', { type: 'number', default: 5 })
  .option('fills_per_interval', { type: 'number', default: 8 })
  .argv;

function nowIso(){ return new Date().toISOString(); }

console.log('[start]', nowIso(), JSON.stringify({
  host: argv.host, port: Number(argv.port),
  bots: Number(argv['bots-per-node']),
  range: Number(argv.range),
  goal_interval_s: Number(argv.goal_interval),
  build_interval_s: Number(argv.build_interval),
  mine_interval_s: Number(argv.mine_interval),
  flush_every_s: Number(argv.flush_every),
  mode: 'Realistic walk/build/mine (no TP spam)'
}));

// One global save-all flush (keeps logs reasonable)
(async () => {
  let conn = null;
  async function ensure(){ 
    if (conn) return conn;
    conn = await Rcon.connect({ host: argv.host, port: Number(argv.rcon_port), password: argv.rcon_password, timeout: 4000 });
    conn.on('end', ()=>{ conn = null; });
    return conn;
  }
  async function rcon(cmd){
    try{ const c = await ensure(); await c.send(cmd); } catch { try{ conn?.end(); }catch{} conn = null; }
  }
  setInterval(()=>{ rcon('save-all flush'); }, Math.max(10, Number(argv.flush_every))*1000);
})();

// Spawn bots
const runId = Math.random().toString(36).slice(2,8);
for (let i = 0; i < Number(argv['bots-per-node']); i++) {
  const username = `cw_${runId}_${i.toString(36)}`;
  const childArgs = [
    '--host', argv.host,
    '--port', String(argv.port),
    '--username', username,
    '--range', String(argv.range),
    '--goal_interval', String(argv.goal_interval),
    '--build_interval', String(argv.build_interval),
    '--mine_interval', String(argv.mine_interval),
    '--rcon_port', String(argv.rcon_port),
    '--rcon_password', argv.rcon_password
  ];
  fork(`${__dirname}/complex_bot.js`, childArgs, { stdio: 'inherit' });
}