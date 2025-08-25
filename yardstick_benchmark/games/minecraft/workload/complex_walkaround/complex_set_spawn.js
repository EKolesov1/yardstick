// complex_set_spawn.js
// Sets the world spawn point on the running PaperMC server

const mineflayer = require('mineflayer');
const { once } = require('events');
const argv = require('yargs')(process.argv.slice(2))
  .option('host', { type: 'string', demandOption: true })
  .argv;

async function setSpawn() {
  const bot = mineflayer.createBot({
    host: argv.host,
    username: 'spawnSetter'
  });
  await once(bot, 'spawn');
  const p = bot.entity.position.floored();
  bot.chat(`/setworldspawn ${p.x} ${p.y} ${p.z}`);
  bot.quit();
}

setSpawn().catch(err => {
  console.error('spawn helper error:', err);
  process.exit(1);
});