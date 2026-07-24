/**
 * 刷新猫咪 6 帧跑步循环（含着地/蹬地/收腿），并更新 sprites.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(__dirname, '..', 'assets');
const runDir = path.join(assets, 'run');

function isNearBlack(r, g, b) {
  return r < 32 && g < 32 && b < 32;
}

function floodBlack(data, w, h) {
  const v = new Uint8Array(w * h);
  const st = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (v[i]) return;
    const o = i * 4;
    if (data[o + 3] === 0 || isNearBlack(data[o], data[o + 1], data[o + 2])) {
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

async function processBlackBg(src, dst) {
  const { data, info } = await sharp(src)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buf = Buffer.from(data);
  const w = info.width;
  const h = info.height;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (isNearBlack(buf[o], buf[o + 1], buf[o + 2])) buf[o + 3] = 0;
  }
  floodBlack(buf, w, h);
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
  const pad = 12;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
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
  fs.mkdirSync(runDir, { recursive: true });

  // 6 帧：蹬地 → 伸展 → 前爪着地 → 收腿 → 伸展2 → 收腿2
  const sources = [
    path.join(assets, 'cat-run-push.png'),
    path.join(assets, 'run', 'run_1.png'), // 已透明，直接用
    path.join(assets, 'cat-run-contact.png'),
    path.join(assets, 'cat-run-gather.png'),
    path.join(assets, 'run', 'run_3.png'),
    path.join(assets, 'run', 'run_2.png'),
  ];

  const raws = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (!fs.existsSync(src)) throw new Error('missing ' + src);
    const dst = path.join(runDir, `cycle_raw_${i + 1}.png`);
    // 已是透明 PNG 的旧帧跳过黑底处理，直接拷贝裁切
    const meta = await sharp(src).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    const hasAlpha = (() => {
      let a0 = 0;
      for (let p = 0; p < meta.info.width * meta.info.height; p++) {
        if (meta.data[p * 4 + 3] < 16) a0++;
      }
      return a0 / (meta.info.width * meta.info.height) > 0.15;
    })();
    if (hasAlpha) {
      // 仅裁切不透明区域
      await sharp(src)
        .trim({ threshold: 8 })
        .png()
        .toFile(dst);
      console.log('trim', path.basename(dst));
    } else {
      await processBlackBg(src, dst);
    }
    raws.push(dst);
  }

  let maxW = 0,
    maxH = 0;
  for (const p of raws) {
    const m = await sharp(p).metadata();
    maxW = Math.max(maxW, m.width);
    maxH = Math.max(maxH, m.height);
  }

  const outs = [];
  for (let i = 0; i < raws.length; i++) {
    const out = path.join(runDir, `run_${i + 1}.png`);
    await sharp(raws[i])
      .resize({
        width: maxW,
        height: maxH,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        position: 'bottom',
      })
      .png()
      .toFile(out);
    outs.push(out);
  }

  const spritesPath = path.join(assets, 'sprites.json');
  const sprites = JSON.parse(fs.readFileSync(spritesPath, 'utf8'));
  const rel = (p) => path.relative(assets, p).replace(/\\/g, '/');
  sprites.run = outs.map(rel);
  sprites.runSize = { width: maxW, height: maxH };
  fs.writeFileSync(spritesPath, JSON.stringify(sprites, null, 2));
  console.log('cat run cycle ready', sprites.run);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
