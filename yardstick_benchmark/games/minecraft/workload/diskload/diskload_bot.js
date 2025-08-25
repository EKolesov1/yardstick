const mineflayer = require('mineflayer');
const { once } = require('events');
const { hideBin } = require('yargs/helpers');
const { Rcon } = require('rcon-client');

const argv = require('yargs')(hideBin(process.argv))
  .option('host', { type: 'string', demandOption: true })
  .option('teleport_interval', { type: 'number', default: 1 })
  .option('range', { type: 'number', default: 5000000 })
  .option('fill_size', { type: 'number', default: 32 })
  .option('fills_per_interval', { type: 'number', default: 6 })
  .option('flush_every', { type: 'number', default: 0 }) // 0 = disabled
  .option('rcon_port', { type: 'number', default: 25575 })
  .option('rcon_password', { type: 'string', demandOption: true })
  .argv;

function randCoord(range) { return Math.floor(Math.random() * (2 * range + 1)) - range; }
function alignTo(x, multiple) { return Math.floor(x / multiple) * multiple; }

async function opSelfViaRcon(username) {
  try {
    const rcon = await Rcon.connect({ host: argv.host, port: argv.rcon_port, password: argv.rcon_password });
    await rcon.send(`op ${username}`);
    await rcon.end();
  } catch (e) {
    console.error('RCON op failed:', e?.message || e);
  }
}

async function run() {
  const bot = mineflayer.createBot({
   host: argv.host,
   username: `diskbot_${Math.floor(Math.random() * 1000000)}`,
   version: '1.21.4'
 });
  await once(bot, 'spawn');

  await opSelfViaRcon(bot.username);
  bot.chat('/save-on');

  const cmd = (s, delayMs = 0) =>
    new Promise((resolve) => setTimeout(() => { bot.chat(s); resolve(); }, delayMs));

  let intervalCount = 0;
  const offsets = [
    [0, 0], [16, 0], [0, 16], [16, 16], [-16, 0], [0, -16],
    [32, 0], [0, 32], [-32, 0], [0, -32]
  ];
  const size = Math.max(2, Math.min(argv.fill_size, 48));
  const y = 64;

  setInterval(async () => {
    try {
      intervalCount++;
      const rawX = randCoord(argv.range);
      const rawZ = randCoord(argv.range);
      const x0 = alignTo(rawX, 16);
      const z0 = alignTo(rawZ, 16);

      await cmd(`/tp ${x0 + 8} ${y} ${z0 + 8}`);

      for (let i = 0; i < argv.fills_per_interval; i++) {
        const [ox, oz] = offsets[i % offsets.length];
        const x1 = x0 + ox;
        const z1 = z0 + oz;
        const x2 = x1 + (size - 1);
        const z2 = z1 + (size - 1);
        await cmd(`/fill ${x1} ${y - 2} ${z1} ${x2} ${y + 2} ${z2} stone replace`, 120);
      }

      // Only a single coordinator does flushes
      if (Number(process.env.FLUSH_LEADER || '0') === 1 &&
          Number(argv.flush_every || 0) > 0 &&
          intervalCount % argv.flush_every === 0) {
        await cmd('/save-all flush', 150);
      }
    } catch (e) {
      console.error('Interval error:', e?.message || e);
    }
  }, Math.max(250, argv.teleport_interval * 1000));
}

run().catch((err) => { console.error(err); process.exit(1); });