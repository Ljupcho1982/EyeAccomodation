// Generates marker/navigator-marker.png: the image printed and taped on the wall.
// ARCore's Augmented Images tracks it and gives the pose that anchors the saved map.
// Deterministic (fixed seed), so the app and the printed copy always match.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const SIZE = 1024;
const MARGIN = 64; // white border
const CELLS = 24; // random blocks per side: many corners, which is what ARCore looks for
const LEVELS = [0, 85, 170, 255];

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x6d6b6e61); // "mkna"
const cell = (SIZE - 2 * MARGIN) / CELLS;
const grid = Array.from({ length: CELLS }, () => Array.from({ length: CELLS }, () => LEVELS[Math.floor(rnd() * LEVELS.length)]));

const raw = Buffer.alloc((SIZE + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const inside = x >= MARGIN && x < SIZE - MARGIN && y >= MARGIN && y < SIZE - MARGIN;
    raw[y * (SIZE + 1) + 1 + x] = inside ? grid[Math.floor((y - MARGIN) / cell)][Math.floor((x - MARGIN) / cell)] : 255;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 0; // grayscale
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('marker', { recursive: true });
writeFileSync('marker/navigator-marker.png', png);
console.log('marker/navigator-marker.png', png.length, 'bytes');
