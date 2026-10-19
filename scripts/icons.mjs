// Generates every app icon (Android launcher, splash, PWA) from one SVG design:
// a staircase of training-log squares, brighter as it rises.
// Usage: npm i --no-save sharp && node scripts/icons.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BG = '#111214';
const TONE = { 0: '#1f2125', 1: '#34363c', 2: '#5a5d65', 3: '#9a9ea6', 4: '#f2f3f5' };
const ALPHA = { 0: 0.16, 1: 0.3, 2: 0.5, 3: 0.75, 4: 1 };
const LEVELS = [
  [0, 0, 0, 4],
  [0, 0, 3, 4],
  [0, 2, 3, 4],
  [1, 2, 3, 4],
];

/** squares grid of side `side` centred on a `size` canvas */
function squares(size, side, { mono = false } = {}) {
  const n = LEVELS.length;
  const gapRatio = 0.16;
  const cell = side / (n + (n - 1) * gapRatio);
  const gap = cell * gapRatio;
  const off = (size - side) / 2;
  let out = '';
  LEVELS.forEach((row, r) =>
    row.forEach((l, c) => {
      const x = off + c * (cell + gap);
      const y = off + r * (cell + gap);
      const fill = mono ? `fill="#ffffff" fill-opacity="${ALPHA[l]}"` : `fill="${TONE[l]}"`;
      out += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${(cell * 0.26).toFixed(2)}" ${fill}/>`;
    }),
  );
  return out;
}

const svg = (size, body, bg = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}${body}</svg>`;

// 108 dp adaptive canvas; launchers show the middle 72 dp, so the grid stays inside 40 dp.
const foreground = svg(108, squares(108, 40));
const monochrome = svg(108, squares(108, 40, { mono: true }));
const legacy = svg(48, squares(48, 26), `<rect x="2" y="2" width="44" height="44" rx="10" fill="${BG}"/>`);
const legacyRound = svg(48, squares(48, 24), `<circle cx="24" cy="24" r="22" fill="${BG}"/>`);
const full = (size, side) => svg(size, squares(size, side), `<rect width="${size}" height="${size}" fill="${BG}"/>`);
const rounded = (size, side) => svg(size, squares(size, side), `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${BG}"/>`);

async function png(svgText, px, file) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(svgText), { density: 72 * (px / Number(svgText.match(/width="(\d+)"/)[1])) * 1 })
    .resize(px, px)
    .png({ compressionLevel: 9 })
    .toFile(file);
}

const res = join(root, 'android/app/src/main/res');
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  await png(foreground, Math.round(108 * k), join(res, `mipmap-${d}/ic_launcher_foreground.png`));
  await png(monochrome, Math.round(108 * k), join(res, `mipmap-${d}/ic_launcher_monochrome.png`));
  await png(legacy, Math.round(48 * k), join(res, `mipmap-${d}/ic_launcher.png`));
  await png(legacyRound, Math.round(48 * k), join(res, `mipmap-${d}/ic_launcher_round.png`));
}

const pub = join(root, 'public/icons');
await png(rounded(512, 230), 192, join(pub, 'icon-192.png'));
await png(rounded(512, 230), 512, join(pub, 'icon-512.png'));
await png(full(512, 200), 512, join(pub, 'maskable-512.png'));
await png(full(512, 230), 180, join(pub, 'apple-touch-icon.png'));
writeFileSync(join(root, 'assets/icon.svg'), rounded(512, 230));
console.log('icons written');
