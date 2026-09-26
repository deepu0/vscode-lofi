// Generate a 128x128 Marketplace PNG icon from the headphones motif in media/icon.svg.
// No external image libraries are available in this environment, so we rasterize a
// simple headphones glyph by hand into an RGBA buffer and encode a PNG using Node's
// built-in zlib. Run: node scripts/gen-icon.mjs media/icon.png
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 128;
const W = SIZE, H = SIZE;
const px = Buffer.alloc(W * H * 4, 0);

const bgRadius = 24;
function insideRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const rx = Math.min(x, w - 1 - x);
  const ry = Math.min(y, h - 1 - y);
  if (rx >= r || ry >= r) return true;
  const dx = r - rx;
  const dy = r - ry;
  return dx * dx + dy * dy <= r * r;
}

function setPx(x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const sa = a / 255;
  px[i] = Math.round(r * sa + px[i] * (1 - sa));
  px[i + 1] = Math.round(g * sa + px[i + 1] * (1 - sa));
  px[i + 2] = Math.round(b * sa + px[i + 2] * (1 - sa));
  px[i + 3] = Math.max(px[i + 3], a);
}

// Background: rounded-corner dark card with a subtle vertical gradient.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!insideRoundedRect(x, y, W, H, bgRadius)) continue;
    const t = y / H;
    const r = Math.round(30 + 20 * t);
    const g = Math.round(32 + 18 * t);
    const b = Math.round(54 + 30 * t);
    setPx(x, y, r, g, b, 255);
  }
}

// Headphones motif matching media/icon.svg geometry, mapped from a 24x24 viewBox.
const accentR = 236, accentG = 224, accentB = 128; // soft yellow
const scale = 4.2;
const offX = (W - 24 * scale) / 2;
const offY = (H - 24 * scale) / 2 + 4;
function P(vx, vy) { return [offX + vx * scale, offY + vy * scale]; }

function stampDisc(cx, cy, radius, r, g, b) {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) setPx(cx + x, cy + y, r, g, b, 255);
    }
  }
}

// Band: arc centered at (12,12) radius 8 across the top half (icon.svg path).
{
  const [cxp, cyp] = P(12, 12);
  const rv = 8 * scale;
  const thickness = Math.max(3, Math.round(1.6 * scale));
  for (let a = Math.PI; a <= 2 * Math.PI + 0.01; a += 0.004) {
    const bx = cxp + Math.cos(a) * rv;
    const by = cyp + Math.sin(a) * rv;
    stampDisc(Math.round(bx), Math.round(by), Math.round(thickness / 2), accentR, accentG, accentB);
  }
}

// Earcups: rounded rects at x=3..7 and x=17..21, y=14..20 (icon.svg rects).
function roundedRect(vx, vy, vw, vh, vr, r, g, b) {
  const [x0, y0] = P(vx, vy);
  const w = vw * scale, h = vh * scale, rad = vr * scale;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (insideRoundedRect(x, y, w, h, rad)) setPx(x0 + x, y0 + y, r, g, b, 255);
    }
  }
}
roundedRect(3, 14, 4, 6, 1.5, accentR, accentG, accentB);
roundedRect(17, 14, 4, 6, 1.5, accentR, accentG, accentB);

// --- PNG encoding (RGBA, 8-bit, filter 0) using zlib deflate ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  px.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = process.argv[2] || "media/icon.png";
writeFileSync(out, png);
console.log("Wrote", out, png.length, "bytes", W + "x" + H);
