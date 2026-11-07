// Erzeugt einfache PWA-Icons (PNG) ohne Bildbibliothek: Sternwarten-Ring mit Mint/Bernstein/Rot.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function icon(size, maskable) {
  const bg = hex('#0b111d');
  const panel = hex('#131b2b');
  const mint = hex('#46e3ad');
  const amber = hex('#f5b54a');
  const red = hex('#ff6b6b');
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const scale = maskable ? 0.78 : 1; // maskable: Inhalt in der sicheren Zone
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / (c * scale);
      const dy = (y + 0.5 - c) / (c * scale);
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      let col = bg;
      if (r < 0.92) col = panel;
      // Sunburst-Segmente
      if (r > 0.42 && r < 0.66) {
        const seg = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 7);
        const gapLine = Math.abs(((a + Math.PI) / (2 * Math.PI)) * 7 - Math.round(((a + Math.PI) / (2 * Math.PI)) * 7)) < 0.04;
        col = gapLine ? panel : seg % 3 === 0 ? amber : mint;
      }
      if (r > 0.7 && r < 0.86) {
        const seg = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 13);
        const gapLine = Math.abs(((a + Math.PI) / (2 * Math.PI)) * 13 - Math.round(((a + Math.PI) / (2 * Math.PI)) * 13)) < 0.06;
        col = gapLine ? panel : seg % 2 ? [Math.round(mint[0] * 0.55), Math.round(mint[1] * 0.55), Math.round(mint[2] * 0.55)] : [Math.round(amber[0] * 0.55), Math.round(amber[1] * 0.55), Math.round(amber[2] * 0.55)];
      }
      if (r < 0.32) col = bg;
      if (r < 0.16) col = mint;
      // roter Lückenpunkt
      if (Math.hypot(dx - 0.55, dy + 0.55) < 0.09) col = red;
      if (!maskable && r > 0.98) col = bg;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = col[0];
      raw[i + 1] = col[1];
      raw[i + 2] = col[2];
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(join(out, 'icon-192.png'), icon(192, false));
writeFileSync(join(out, 'icon-512.png'), icon(512, false));
writeFileSync(join(out, 'icon-maskable-512.png'), icon(512, true));
writeFileSync(join(out, 'apple-touch-icon.png'), icon(180, true));
console.log('[icons] public/icons/*.png');
