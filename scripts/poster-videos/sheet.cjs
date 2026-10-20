/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS tool script */
// usage: POSTER_RAW_DIR=<dir> node sheet.cjs <id> [everySec=4] [from=recStart] [cols=6] [rows=5] [crop=x:y:w:h]
// Contact sheet of the raw recording (full 960×1200 frame by default), each
// tile stamped with its second offset in the raw video → <dir>/sheets/<id>.png
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const raw = process.env.POSTER_RAW_DIR || path.join(require('os').tmpdir(), 'poster-raw');
const id = process.argv[2];
const every = +(process.argv[3] || 4);
const meta = JSON.parse(fs.readFileSync(path.join(raw, id + '.json')));
const from = process.argv[4] ? +process.argv[4] : Math.floor(meta.recStart || 0);
const cols = +(process.argv[5] || 6), rows = +(process.argv[6] || 5);
const crop = process.argv[7];
fs.mkdirSync(path.join(raw, 'sheets'), { recursive: true });
const font = "C\\:/Windows/Fonts/arialbd.ttf";
const vf = [
  crop ? `crop=${crop.split(':')[2]}:${crop.split(':')[3]}:${crop.split(':')[0]}:${crop.split(':')[1]}` : null,
  `fps=1/${every}`,
  crop ? 'scale=200:250' : 'scale=240:300',
  `drawtext=fontfile='${font}':text='%{eif\\:t+${from}\\:d}':x=4:y=4:fontsize=24:fontcolor=yellow:box=1:boxcolor=black@0.7`,
  `tile=${cols}x${rows}:padding=2`,
].filter(Boolean).join(',');
const out = path.join(raw, 'sheets', id + (process.argv[4] ? '-' + from : '') + '.png');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(from), '-i', path.join(raw, id + '.webm'), '-vf', vf, '-frames:v', '1', out], { stdio: 'inherit' });
console.log(out);
