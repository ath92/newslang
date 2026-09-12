#!/usr/bin/env node
/**
 * Generates the PWA icons into `public/` without any image dependency.
 *
 * The brand mark is a rounded red tile holding a cream "article" page with a
 * short headline and three text lines. Everything is drawn at 4x and box
 * downsampled for antialiasing, then written as RGBA PNGs.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const SUPERSAMPLE = 4;

const ACCENT = [176, 35, 24, 255]; // --accent
const PAPER = [250, 248, 244, 255]; // --bg

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------------- drawing

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  set(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const sa = a / 255;
    const da = this.data[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA === 0) return;
    this.data[i] = (r * sa + this.data[i] * da * (1 - sa)) / outA;
    this.data[i + 1] = (g * sa + this.data[i + 1] * da * (1 - sa)) / outA;
    this.data[i + 2] = (b * sa + this.data[i + 2] * da * (1 - sa)) / outA;
    this.data[i + 3] = Math.round(outA * 255);
  }

  fillRect(x, y, w, h, color) {
    const [r, g, b, a] = color;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) this.set(px, py, r, g, b, a);
    }
  }

  fillRoundRect(x, y, w, h, radius, color) {
    const [r, g, b, a] = color;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    const r2 = radius * radius;
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        const cx = Math.min(Math.max(px + 0.5, x + radius), x + w - radius);
        const cy = Math.min(Math.max(py + 0.5, y + radius), y + h - radius);
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.set(px, py, r, g, b, a);
      }
    }
  }

  /** Box downsample, averaging premultiplied alpha to avoid dark fringes. */
  downsample(factor) {
    const out = new Canvas(this.width / factor, this.height / factor);
    const samples = factor * factor;
    for (let oy = 0; oy < out.height; oy += 1) {
      for (let ox = 0; ox < out.width; ox += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < factor; sy += 1) {
          for (let sx = 0; sx < factor; sx += 1) {
            const i = ((oy * factor + sy) * this.width + ox * factor + sx) * 4;
            const sa = this.data[i + 3] / 255;
            r += this.data[i] * sa;
            g += this.data[i + 1] * sa;
            b += this.data[i + 2] * sa;
            a += sa;
          }
        }
        const oi = (oy * out.width + ox) * 4;
        const avgA = a / samples;
        if (avgA > 0) {
          out.data[oi] = r / samples / avgA;
          out.data[oi + 1] = g / samples / avgA;
          out.data[oi + 2] = b / samples / avgA;
        }
        out.data[oi + 3] = Math.round(avgA * 255);
      }
    }
    return out;
  }
}

function drawIcon(canvas, { scale = 1, rounded = true } = {}) {
  const size = canvas.width;

  if (rounded) {
    canvas.fillRoundRect(0, 0, size, size, size * 0.22, ACCENT);
  } else {
    canvas.fillRect(0, 0, size, size, ACCENT);
  }

  const pageW = size * 0.58 * scale;
  const pageH = size * 0.72 * scale;
  const pageX = (size - pageW) / 2;
  const pageY = (size - pageH) / 2;
  canvas.fillRoundRect(pageX, pageY, pageW, pageH, size * 0.075 * scale, PAPER);

  const pad = pageW * 0.16;
  const contentX = pageX + pad;
  const contentW = pageW - pad * 2;
  const lineH = size * 0.05 * scale;
  const gap = size * 0.052 * scale;
  const widths = [0.72, 1, 1, 0.52];
  const blockH = widths.length * lineH + (widths.length - 1) * gap;
  let lineY = pageY + (pageH - blockH) / 2;

  for (const fraction of widths) {
    canvas.fillRoundRect(contentX, lineY, contentW * fraction, lineH, lineH / 2, ACCENT);
    lineY += lineH + gap;
  }
}

function writeIcon(name, size, options) {
  const canvas = new Canvas(size * SUPERSAMPLE, size * SUPERSAMPLE);
  drawIcon(canvas, options);
  const scaled = canvas.downsample(SUPERSAMPLE);
  writeFileSync(resolve(OUT_DIR, name), encodePng(scaled.width, scaled.height, scaled.data));
  console.log(`wrote public/${name} (${size}x${size})`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeIcon("icon-96.png", 96, {});
writeIcon("icon-192.png", 192, {});
writeIcon("icon-512.png", 512, {});
writeIcon("icon-maskable-512.png", 512, { scale: 0.78, rounded: false });
writeIcon("apple-touch-icon.png", 180, { rounded: false });
