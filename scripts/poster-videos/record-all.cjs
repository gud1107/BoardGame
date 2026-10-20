/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS tool script */
// POSTER_RAW_DIR=<dir> PWCORE=<path> node record-all.cjs [seconds] [concurrency] [ids...]
// Records several games in parallel (3 at a time keeps swiftshader usable).
const { spawn } = require('child_process');
const sec = process.argv[2] || '150', conc = +(process.argv[3] || 3);
const ALL = 'alkkagi bang bluff-roulette century chess city-chase coup coyote crab-survival curling five-cucumbers for-sale hanamikoji hungry-shark ink-duel las-vegas liar-game lost-cities lotr-duel love-letter love-wins-all mal-dalli-ja no-thanks perudo rat-a-tat-cat show-me-the-coin splendor splendor-duel spot-difference summoners-rift wobble-tower word-tower'.split(' ');
const ids = process.argv.length > 4 ? process.argv.slice(4) : ALL;
let i = 0;
const next = () => {
  if (i >= ids.length) return;
  const id = ids[i++];
  const p = spawn(process.execPath, [__dirname + '/record.cjs', id, sec], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  p.stdout.on('data', (d) => process.stdout.write(d));
  p.stderr.on('data', (d) => process.stdout.write(id + ' ERR ' + String(d).slice(0, 200) + '\n'));
  p.on('exit', next);
};
for (let k = 0; k < conc; k++) next();
