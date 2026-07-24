/**
 * 处理小孩角色：静立 + 追赶跑步帧
 * 使用 fullhat / full-run 源图，并强制顶部留白，避免帽子被裁切。
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

/** 闭合网眼小洞，避免帽子/网衫被抠穿后碎片化 */
function closeAlpha(data, w, h, radius = 2) {
  const src = Buffer.from(data);
  const mark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[(y * w + x) * 4 + 3] >= 16) continue;
      let near = 0;
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const o = (ny * w + nx) * 4;
          if (src[o + 3] < 16) continue;
          near++;
          r += src[o];
          g += src[o + 1];
          b += src[o + 2];
          n++;
        }
      }
      const need = (radius * 2 + 1) * (radius * 2 + 1) * 0.35;
      if (near >= need && n) {
        mark[y * w + x] = 1;
        const o = (y * w + x) * 4;
        data[o] = Math.round(r / n);
        data[o + 1] = Math.round(g / n);
        data[o + 2] = Math.round(b / n);
        data[o + 3] = 255;
      }
    }
  }
}

/** 源图四周先垫绿幕，避免帽子贴边被裁掉 */
async function padGreen(src, topRatio = 0.14) {
  const meta = await sharp(src).metadata();
  const top = Math.max(48, Math.round(meta.height * topRatio));
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
  const hasGreen = (() => {
    let g = 0;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (isPureGreen(buf[o], buf[o + 1], buf[o + 2])) g++;
    }
    return g / (w * h) > 0.08;
  })();

  if (hasGreen) {
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
    // 先闭合网眼，再边缘清理，避免帽子顶被绿幕“啃平”
    closeAlpha(buf, w, h, 2);
    flood(buf, w, h);
    closeAlpha(buf, w, h, 2);
    keepLargest(buf, w, h);
  }

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
  // 裁切后仍保留明显顶部透明留白，防止窗口再裁帽子
  const padX = 12;
  const padBottom = 10;
  const padTop = Math.max(36, Math.round((maxY - minY + 1) * 0.1));
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padTop);
  maxX = Math.min(w - 1, maxX + padX);
  maxY = Math.min(h - 1, maxY + padBottom);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  // 再额外向上扩展透明区（即使源图贴顶也有安全边）
  const extraTop = Math.max(40, Math.round(cropH * 0.08));
  const outW = cropW;
  const outH = cropH + extraTop;

  const cropped = await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .extract({
      left: minX,
      top: minY,
      width: cropW,
      height: cropH,
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: outW,
      height: outH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: cropped, top: extraTop, left: 0 }])
    .png()
    .toFile(dst);
  console.log('ok', path.basename(dst), `${outW}x${outH}`);
}

async function main() {
  fs.mkdirSync(boyDir, { recursive: true });

  const idleSrc = [
    path.join(assets, 'boy-idle-fullhat.png'),
    path.join(assets, 'boy-idle-v2.png'),
    path.join(assets, 'boy-idle.png'),
  ].find((p) => fs.existsSync(p));
  if (!idleSrc) throw new Error('missing idle source');

  // 4 帧统一朝右；r1 源图朝左需翻转（若再处理仍反，输出后再强翻一次）
  const runPlan = [
    { file: 'boy-run-r1.png', flop: true },
    { file: 'boy-run-r3.png', flop: false },
    { file: 'boy-run-r2.png', flop: false },
    { file: 'boy-run-r4.png', flop: false },
  ];
  const runSources = runPlan.map((p) => path.join(assets, p.file));
  for (const p of runSources) {
    if (!fs.existsSync(p)) {
      throw new Error(`missing run source: ${path.basename(p)}`);
    }
  }

  await processOne(idleSrc, path.join(boyDir, 'idle_raw.png'));

  const runRaws = [];
  for (let i = 0; i < runSources.length; i++) {
    const dst = path.join(boyDir, `run_raw_${i + 1}.png`);
    await processOne(runSources[i], dst);
    runRaws.push(dst);
  }

  let maxW = 0,
    maxH = 0;
  for (const p of runRaws) {
    const m = await sharp(p).metadata();
    maxW = Math.max(maxW, m.width);
    maxH = Math.max(maxH, m.height);
  }
  const idleMeta = await sharp(path.join(boyDir, 'idle_raw.png')).metadata();
  maxW = Math.max(maxW, idleMeta.width);
  maxH = Math.max(maxH, idleMeta.height);

  // 与猫咪一致：默认朝右
  const runOuts = [];
  for (let i = 0; i < runRaws.length; i++) {
    const out = path.join(boyDir, `run_${i + 1}.png`);
    await sharp(runRaws[i])
      .resize({
        width: maxW,
        height: maxH,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        position: 'bottom',
      })
      .png()
      .toFile(out);
    runOuts.push(out);
  }

  // 统一画布再加顶部安全区，防止 Electron 窗口裁帽子
  const safeTop = Math.max(56, Math.round(maxH * 0.12));
  const finalW = maxW;
  const finalH = maxH + safeTop;

  async function withSafeTop(srcPath, dstPath) {
    const resized = await sharp(srcPath)
      .resize({
        width: maxW,
        height: maxH,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        position: 'bottom',
      })
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: finalW,
        height: finalH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: resized, top: safeTop, left: 0 }])
      .png()
      .toFile(dstPath);
  }

  for (let i = 0; i < runOuts.length; i++) {
    await withSafeTop(runOuts[i], runOuts[i]);
    // 最后再翻转，避免中间步骤把朝向弄乱
    if (runPlan[i].flop) {
      const tmp = `${runOuts[i]}.flip.png`;
      await sharp(runOuts[i]).flop().png().toFile(tmp);
      fs.renameSync(tmp, runOuts[i]);
    }
  }

  const idleOut = path.join(boyDir, 'idle.png');
  await withSafeTop(path.join(boyDir, 'idle_raw.png'), idleOut);

  const spritesPath = path.join(assets, 'sprites.json');
  const sprites = JSON.parse(fs.readFileSync(spritesPath, 'utf8'));
  const rel = (p) => path.relative(assets, p).replace(/\\/g, '/');
  sprites.boy = {
    idle: rel(idleOut),
    run: runOuts.map(rel),
    idleSize: { width: finalW, height: finalH },
    runSize: { width: finalW, height: finalH },
  };
  fs.writeFileSync(spritesPath, JSON.stringify(sprites, null, 2));
  console.log('boy sprites ready', sprites.boy);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
