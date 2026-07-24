/**
 * 处理人物停下动作切图：伸懒腰 / 哈欠 / 笑 / 摸猫 / 递果汁
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(__dirname, '..', 'assets');
const boyDir = path.join(assets, 'boy');

function isPureGreen(r, g, b) {
  return g > 90 && g >= r + 35 && g >= b + 35;
}

function despill(r, g, b) {
  if (g > r + 8 && g > b + 8) {
    const over = Math.min(g - r, g - b);
    g = Math.max(r, b, g - Math.round(over * 0.85));
  }
  return [r, Math.min(255, g), b];
}

function flood(data, w, h) {
  const v = new Uint8Array(w * h);
  const st = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (v[i]) return;
    const o = i * 4;
    if (data[o + 3] === 0 || isPureGreen(data[o], data[o + 1], data[o + 2])) {
      v[i] = 1;
      data[o + 3] = 0;
      st.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (st.length) {
    const i = st.pop();
    const x = i % w;
    const y = (i - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

function keepLargest(data, w, h) {
  const seen = new Uint8Array(w * h);
  let best = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || data[i * 4 + 3] < 16) continue;
    const q = [i];
    seen[i] = 1;
    const cells = [];
    while (q.length) {
      const c = q.pop();
      cells.push(c);
      const cx = c % w;
      const cy = (c - cx) / w;
      for (const [nx, ny] of [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (seen[n] || data[n * 4 + 3] < 16) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    if (cells.length > best.length) best = cells;
  }
  const keep = new Uint8Array(w * h);
  for (const i of best) keep[i] = 1;
  for (let i = 0; i < w * h; i++) if (!keep[i]) data[i * 4 + 3] = 0;
}

async function padGreen(src) {
  const meta = await sharp(src).metadata();
  const top = Math.max(48, Math.round(meta.height * 0.12));
  const side = Math.max(24, Math.round(meta.width * 0.06));
  const bottom = Math.max(24, Math.round(meta.height * 0.04));
  return sharp(src)
    .ensureAlpha()
    .extend({
      top,
      bottom,
      left: side,
      right: side,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    })
    .png()
    .toBuffer();
}

async function processOne(src, dst) {
  const padded = await padGreen(src);
  const { data, info } = await sharp(padded)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buf = Buffer.from(data);
  const w = info.width;
  const h = info.height;

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (isPureGreen(buf[o], buf[o + 1], buf[o + 2])) buf[o + 3] = 0;
    else {
      const [r, g, b] = despill(buf[o], buf[o + 1], buf[o + 2]);
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = 255;
    }
  }
  flood(buf, w, h);
  keepLargest(buf, w, h);

  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + 3] > 12) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const padX = 12;
  const padBottom = 10;
  const padTop = Math.max(36, Math.round((maxY - minY + 1) * 0.08));
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padTop);
  maxX = Math.min(w - 1, maxX + padX);
  maxY = Math.min(h - 1, maxY + padBottom);

  await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .extract({
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    })
    .png()
    .toFile(dst);
  console.log('ok', path.basename(dst));
}

async function main() {
  fs.mkdirSync(boyDir, { recursive: true });
  const spritesPath = path.join(assets, 'sprites.json');
  const sprites = JSON.parse(fs.readFileSync(spritesPath, 'utf8'));
  const targetW = sprites.boy?.idleSize?.width || 642;
  const targetH = sprites.boy?.idleSize?.height || 1219;

  const acts = [
    { key: 'stretch', file: 'boy-act-stretch.png', flop: false },
    { key: 'yawn', file: 'boy-act-yawn.png', flop: false },
    { key: 'laugh', file: 'boy-act-laugh.png', flop: false },
    { key: 'pet', file: 'boy-act-pet.png', flop: false },
    { key: 'offer', file: 'boy-act-offer.png', flop: false },
  ];

  const outMap = {};
  for (const act of acts) {
    const src = path.join(assets, act.file);
    if (!fs.existsSync(src)) throw new Error('missing ' + act.file);
    const raw = path.join(boyDir, `act_${act.key}_raw.png`);
    await processOne(src, raw);
    const out = path.join(boyDir, `act_${act.key}.png`);
    let pipeline = sharp(raw).resize({
      width: targetW,
      height: targetH,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      position: 'bottom',
    });
    if (act.flop) pipeline = pipeline.flop();
    await pipeline.png().toFile(out);
    outMap[act.key] = path.relative(assets, out).replace(/\\/g, '/');
  }

  sprites.boy = sprites.boy || {};
  sprites.boy.acts = outMap;
  fs.writeFileSync(spritesPath, JSON.stringify(sprites, null, 2));
  console.log('boy acts ready', outMap);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
