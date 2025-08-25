const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const Vec3 = require('vec3').Vec3;
const { Rcon } = require('rcon-client');
const { hideBin } = require('yargs/helpers');

const argv = require('yargs')(hideBin(process.argv))
  .option('host', { type: 'string', demandOption: true })
  .option('port', { type: 'number', default: 25565 })
  .option('username', { type: 'string', demandOption: true })
  .option('range', { type: 'number', default: 800 })
  .option('goal_interval', { type: 'number', default: 20 })
  .option('build_interval', { type: 'number', default: 7 })
  .option('mine_interval', { type: 'number', default: 11 })
  .option('rcon_port', { type: 'number', default: 25575 })
  .option('rcon_password', { type: 'string', default: 'password' })
  .argv;

function ri(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function nowIso(){ return new Date().toISOString(); }
function scatterXZ(r){ return [ri(-r,r), ri(-r,r)]; }

// RCON helper (per-bot for spawn setup only)
let rc = null;
async function rcon(cmd){
  try{
    if (!rc) {
      rc = await Rcon.connect({ host: argv.host, port: Number(argv.rcon_port), password: argv.rcon_password, timeout: 4000 });
      rc.on('end', ()=>{ rc = null; });
    }
    await rc.send(cmd);
  }catch{ try{ rc?.end(); }catch{} rc = null; }
}

async function equipByName(bot, name){
  const it = bot.inventory.items().find(i => i?.name === name);
  if (!it) return false;
  try{ await bot.equip(it, 'hand'); return true; } catch { return false; }
}

async function placeOne(bot){
  const base = bot.entity.position.floored();
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for(const [dx,dz] of dirs){
    const support = bot.blockAt(base.offset(dx, -1, dz));
    const above   = bot.blockAt(base.offset(dx, 0,  dz));
    if (!support || !above) continue;
    if (support.name !== 'air' && above.name === 'air'){
      const ok = await (equipByName(bot,'cobblestone') || equipByName(bot,'oak_planks'));
      if (!ok) return;
      try{ await bot.placeBlock(support, new Vec3(0,1,0)); return; }catch{}
    }
  }
}

function findNearbyBreakable(bot, maxR=3){
  const center = bot.entity.position.floored();
  const ok = new Set(['dirt','grass_block','sand','gravel','oak_leaves','spruce_leaves','birch_leaves']);
  for(let dy=0; dy<=1; dy++){
    for(let dx=-maxR; dx<=maxR; dx++){
      for(let dz=-maxR; dz<=maxR; dz++){
        const b = bot.blockAt(center.offset(dx, dy, dz));
        if (b && ok.has(b.name) && bot.canDigBlock(b)) return b;
      }
    }
  }
  return null;
}

(async () => {
  const bot = mineflayer.createBot({
    host: argv.host,
    port: Number(argv.port),
    username: argv.username,
    auth: 'offline'
  });
  bot.loadPlugin(pathfinder);

  bot.once('spawn', async () => {
    console.log('[spawn]', nowIso(), argv.username);

    // one-time spawn setup via RCON (no OP on the bot required)
    await rcon(`gamemode survival ${argv.username}`);
    await rcon(`gamerule keepInventory true`);
    await rcon(`give ${argv.username} cobblestone 128`);
    await rcon(`give ${argv.username} oak_planks 128`);
    await rcon(`give ${argv.username} stone_pickaxe 1`);
    await rcon(`give ${argv.username} cooked_beef 32`);
    const [sx,sz] = scatterXZ(Number(argv.range));
    await rcon(`tp ${argv.username} ${sx} 70 ${sz}`);

    const mov = new Movements(bot);
    bot.pathfinder.setMovements(mov);

    const schedule = (fn, baseMs, jitter=0)=> setTimeout(fn, baseMs + ri(-jitter, jitter));

    const wander = () => {
      const [x,z] = scatterXZ(Number(argv.range));
      try{ bot.pathfinder.setGoal(new GoalNear(x, 70, z, 2)); }catch{}
      schedule(wander, Number(argv.goal_interval)*1000, 3000);
    };
    schedule(wander, ri(800, 3000));

    const doPlace = async () => {
      try{ await placeOne(bot); }catch{}
      schedule(doPlace, Number(argv.build_interval)*1000, 1000);
    };
    schedule(doPlace, ri(3000,7000));

    const doMine = async () => {
      try{ const b = findNearbyBreakable(bot, 3); if (b) await bot.dig(b); }catch{}
      schedule(doMine, Number(argv.mine_interval)*1000, 1500);
    };
    schedule(doMine, ri(4000,9000));
  });

  bot.on('kicked', r=>console.log('[kicked]', nowIso(), argv.username, r));
  bot.on('error',  e=>console.log('[error]',  nowIso(), argv.username, e?.message || e));
  bot.on('end',    ()=>process.exit(0));
})();