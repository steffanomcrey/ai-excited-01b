// SPDX-License-Identifier: MIT
// "The Paper Plane That Tore the Sky" - ai-excited-01
// A tiny white-and-red paper plane tears a jagged diagonal rip across a
// deep indigo night sky; through the rip blazes a huge golden sunrise,
// light flooding out, sparks and small birds escaping through the tear.
// Pure Node stdlib, fixed-seed PRNG, own PNG writer, no network,
// no text in the image, deterministic: two runs write identical bytes.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// --- fixed-seed PRNG (mulberry32), the only source of randomness ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// --- pixel buffer ---
const buf = new Uint8Array(W * H * 3);
function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
function setPx(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = clamp255(Math.round(r));
  buf[i + 1] = clamp255(Math.round(g));
  buf[i + 2] = clamp255(Math.round(b));
}
function addPx(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = clamp255(buf[i] + r);
  buf[i + 1] = clamp255(buf[i + 1] + g);
  buf[i + 2] = clamp255(buf[i + 2] + b);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// --- tear geometry: diagonal from bottom-left to top-right ---
const AX = 70;
const AY = 950;
const BX = 950;
const BY = 80;
const DX = BX - AX;
const DY = BY - AY;
const LEN = Math.hypot(DX, DY);
const UX = DX / LEN;
const UY = DY / LEN;
const NX = -UY;
const NY = UX;
// Sun-disc focal burst at the middle of the tear.
const SUN_T = 0.55;
const SX = AX + SUN_T * DX;
const SY = AY + SUN_T * DY;

// Torn-paper edge: seeded control points along the tear, linearly
// interpolated, so the rip is angular and irregular, not a smooth wave.
const EDGE_POINTS = 33;
const edgeShiftTable: Array<number> = [];
const edgeWidthTable: Array<number> = [];
for (let i = 0; i < EDGE_POINTS; i++) {
  edgeShiftTable.push((rand() * 2 - 1) * 13);
  edgeWidthTable.push(1 + (rand() * 2 - 1) * 0.13);
}
function interpTable(table: Array<number>, t: number): number {
  const f = Math.min(Math.max(t / LEN, 0), 1) * (EDGE_POINTS - 1);
  const i = Math.min(Math.floor(f), EDGE_POINTS - 2);
  const frac = f - i;
  return table[i] * (1 - frac) + table[i + 1] * frac;
}
function tearHalfWidth(t: number): number {
  const f = Math.min(Math.max(t / LEN, 0), 1);
  const base = 24 + 64 * Math.pow(Math.sin(Math.PI * f), 0.8);
  return base * interpTable(edgeWidthTable, t);
}
function tearEdgeShift(t: number): number {
  return interpTable(edgeShiftTable, t);
}
// Signed distance from the tear centre line, and whether (x, y) is inside.
function tearAt(x: number, y: number): { t: number; d: number; w: number } {
  const px = x - AX;
  const py = y - AY;
  const t = px * UX + py * UY;
  const s = px * NX + py * NY;
  const w = tearHalfWidth(t);
  const d = Math.abs(s - tearEdgeShift(t));
  return { t, d, w };
}

// --- sky + tear + glow, one pass over every pixel ---
function renderSky(): void {
  for (let y = 0; y < H; y++) {
    const fy = y / (H - 1);
    // Deep indigo night sky, slightly lighter toward the horizon.
    const sr = lerp(9, 40, fy * fy);
    const sg = lerp(13, 46, fy * fy);
    const sb = lerp(46, 100, fy * fy);
    for (let x = 0; x < W; x++) {
      const { t, d, w } = tearAt(x, y);
      if (t > -20 && t < LEN + 20 && d < w) {
        // Inside the tear: blazing golden sunrise.
        const f = Math.min(Math.max(t / LEN, 0), 1);
        const rSun = Math.hypot(x - SX, y - SY);
        const core = Math.exp(-rSun / 110);
        const k = Math.min(rSun / 300, 1);
        // Deep amber at the tear rim, gold mid-way, near-white at the sun.
        let r = lerp(lerp(255, 255, k), 214, k);
        let g = lerp(lerp(216, 150, k), 96, k);
        let b = lerp(lerp(120, 40, k), 26, k);
        r += core * 60;
        g += core * 55;
        b += core * 90;
        // Brighter toward the middle of the tear, dimmer toward its ends.
        const along = 1 - 0.2 * (Math.abs(f - SUN_T) / SUN_T);
        // Brighter at the tear centre, darker at its torn rim.
        const across = 0.78 + 0.22 * (1 - d / w);
        const m = along * across;
        setPx(x, y, r * m + 30 * (1 - m), g * m + 12 * (1 - m), b * m + 6 * (1 - m));
      } else {
        let r = sr;
        let g = sg;
        let b = sb;
        if (t > -20 && t < LEN + 20) {
          const outside = d - w;
          if (outside >= 0 && outside < 3) {
            // Torn edge shadow on the sky side of the rip.
            r *= 0.55;
            g *= 0.55;
            b *= 0.55;
          } else if (outside < 120) {
            // Warm light flooding out of the tear onto the night sky.
            const glow = Math.exp(-outside / 48) * 0.45;
            r += 255 * glow;
            g += 170 * glow;
            b += 60 * glow;
          }
          if (d < w + 3 && d >= w) {
            // Bright rim just inside the tear edge is handled above;
            // this branch is unreachable by construction, kept for clarity.
          }
        }
        setPx(x, y, r, g, b);
      }
    }
  }
}

// --- stars, seeded, only where the sky shows (never inside the tear) ---
function renderStars(): void {
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * (H - 140));
    const { d, w } = tearAt(x, y);
    if (d < w + 6) continue;
    const bright = 90 + rand() * 165;
    const big = rand() < 0.08;
    setPx(x, y, bright, bright, Math.min(255, bright + 25));
    if (big) {
      setPx(x + 1, y, bright * 0.7, bright * 0.7, bright * 0.7);
      setPx(x, y + 1, bright * 0.7, bright * 0.7, bright * 0.7);
      setPx(x - 1, y, bright * 0.5, bright * 0.5, bright * 0.5);
      setPx(x, y - 1, bright * 0.5, bright * 0.5, bright * 0.5);
    }
  }
}

// --- dark mountain ridge along the bottom, foreground over the tear ---
function ridgeTop(x: number): number {
  return (
    884 +
    34 * Math.sin(x * 0.008 + 1.2) +
    26 * Math.sin(x * 0.021 + 4.0) +
    14 * Math.sin(x * 0.043 + 0.7) +
    10 * Math.sin(x * 0.09 + 2.2)
  );
}
function renderRidge(): void {
  for (let x = 0; x < W; x++) {
    const top = ridgeTop(x);
    for (let y = Math.floor(top); y < H; y++) {
      const fy = (y - top) / (H - top);
      const r = lerp(10, 16, fy);
      const g = lerp(12, 18, fy);
      const b = lerp(30, 38, fy);
      setPx(x, y, r, g, b);
    }
    // Faint gold rim light where the tear's glow catches the peaks.
    const { d, w } = tearAt(x, Math.floor(top) - 1);
    if (d < w + 90) {
      const rim = Math.exp(-Math.max(d - w, 0) / 40) * 0.5;
      addPx(x, Math.floor(top) - 1, 200 * rim, 140 * rim, 40 * rim);
      addPx(x, Math.floor(top) - 2, 120 * rim, 80 * rim, 20 * rim);
    }
  }
}

// --- gold sparks escaping through and around the tear ---
function disc(cx: number, cy: number, rad: number, r: number, g: number, b: number): void {
  for (let yy = Math.floor(cy - rad); yy <= Math.ceil(cy + rad); yy++) {
    for (let xx = Math.floor(cx - rad); xx <= Math.ceil(cx + rad); xx++) {
      if (Math.hypot(xx - cx, yy - cy) <= rad) addPx(xx, yy, r, g, b);
    }
  }
}
function renderSparks(): void {
  for (let i = 0; i < 90; i++) {
    const t = (0.05 + rand() * 0.9) * LEN;
    const w = tearHalfWidth(t);
    const e = tearEdgeShift(t);
    const side = rand() < 0.5 ? -1 : 1;
    const off = e + side * (w * rand() * 0.9 + rand() * 130);
    const cx = AX + t * UX + off * NX;
    const cy = AY + t * UY + off * NY;
    if (cy > ridgeTop(cx)) continue;
    const bright = 120 + rand() * 135;
    if (rand() < 0.3) {
      // Short streak along the tear's diagonal, motion away from the rip.
      const len = 3 + rand() * 4;
      for (let s = 0; s < len; s++) {
        addPx(Math.round(cx - s * UX * 1.4), Math.round(cy - s * UY * 1.4), bright, bright * 0.75, bright * 0.3);
      }
    } else {
      disc(cx, cy, rand() < 0.2 ? 2 : 1, bright, bright * 0.72, bright * 0.28);
    }
  }
}

// --- small dark birds escaping through the tear ---
function line(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    setPx(x, y, r, g, b);
    setPx(x + 1, y, r, g, b);
  }
}
function drawBird(cx: number, cy: number, k: number): void {
  const r = 12;
  const g = 14;
  const b = 34;
  // Two curved wings meeting at the body, classic distant-bird "v".
  line(cx, cy, cx - k, cy - k * 0.45, r, g, b);
  line(cx - k, cy - k * 0.45, cx - k * 1.15, cy - k * 0.1, r, g, b);
  line(cx, cy, cx + k, cy - k * 0.45, r, g, b);
  line(cx + k, cy - k * 0.45, cx + k * 1.15, cy - k * 0.1, r, g, b);
}
function renderBirds(): void {
  for (let i = 0; i < 7; i++) {
    const t = (0.28 + rand() * 0.5) * LEN;
    const w = tearHalfWidth(t);
    const e = tearEdgeShift(t);
    const off = e + (rand() - 0.5) * w * 1.1;
    const cx = AX + t * UX + off * NX;
    const cy = AY + t * UY + off * NY;
    if (cy > ridgeTop(cx) - 10) continue;
    drawBird(cx, cy, 8 + rand() * 10);
  }
}

// --- the paper plane at the tear's leading tip, nose pointing north-east ---
function pointInPoly(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
function renderPlane(): void {
  const pcx = AX + 0.92 * DX;
  const pcy = AY + 0.92 * DY;
  const ang = Math.atan2(UY, UX);
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const toWorld = (lx: number, ly: number): [number, number] => [
    pcx + lx * cos - ly * sin,
    pcy + lx * sin + ly * cos,
  ];
  // Local coords: nose at +x, tail at -x, wingspan across y.
  const topWing = [toWorld(78, 0), toWorld(-64, -54), toWorld(-30, -4)];
  const bottomWing = [toWorld(78, 0), toWorld(-64, 54), toWorld(-30, 4)];
  const redFold = [toWorld(78, 0), toWorld(-30, -4), toWorld(-30, 4)];
  const polys: Array<{ poly: Array<[number, number]>; c: [number, number, number] }> = [
    { poly: topWing, c: [246, 247, 252] },
    { poly: bottomWing, c: [198, 203, 218] },
    { poly: redFold, c: [216, 50, 50] },
  ];
  const minX = Math.floor(pcx - 110);
  const maxX = Math.ceil(pcx + 110);
  const minY = Math.floor(pcy - 110);
  const maxY = Math.ceil(pcy + 110);
  for (const { poly, c } of polys) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (pointInPoly(x + 0.5, y + 0.5, poly)) setPx(x, y, c[0], c[1], c[2]);
      }
    }
  }
  // Thin dark outline along each wing edge.
  const outline: [number, number, number] = [70, 72, 90];
  const edges: Array<[[number, number], [number, number]]> = [
    [topWing[0], topWing[1]],
    [topWing[1], topWing[2]],
    [bottomWing[0], bottomWing[1]],
    [bottomWing[1], bottomWing[2]],
  ];
  for (const [a, b] of edges) {
    line(Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1]), outline[0], outline[1], outline[2]);
  }
  // Three short white motion streaks trailing behind the tail.
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 16;
    const sx = pcx - 78 * cos - off * sin;
    const sy = pcy - 78 * sin + off * cos;
    const len = 18 + i * 9;
    for (let s = 0; s < len; s++) {
      const fade = 1 - s / len;
      addPx(Math.round(sx - s * UX * 1.2), Math.round(sy - s * UY * 1.2), 150 * fade, 150 * fade, 160 * fade);
    }
  }
}

// --- minimal PNG writer: signature, IHDR, IDAT (zlib), IEND ---
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc32(crcData));
  return out;
}
function encodePng(): Uint8Array {
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(buf.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, W);
  iv.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function main(): void {
  renderSky();
  renderStars();
  renderRidge();
  renderSparks();
  renderBirds();
  renderPlane();
  const png = encodePng();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.png");
  writeFileSync(outPath, png);
  const sha = createHash("sha256").update(png).digest("hex");
  console.log(`wrote ${outPath} ${png.length} bytes ${W}x${H} sha256=${sha}`);
}

main();
