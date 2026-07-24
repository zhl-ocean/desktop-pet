/**
 * 绿幕抠图：静图 / 跑步精灵帧
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');

function isPureGreen(r, g, b) {
  // 只认绿幕，不再把灰色毛发当棋盘删掉
  return g > 90 && g >= r + 35 && g >= b + 35;
}

function isEdgeBg(r, g, b) {
  // 仅用于从边缘洪水填充：绿幕 + 灰棋盘残渣 + 近白底
  if (isPureGreen(r, g, b)) return true;
  const checker =
    Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r >= 150 && r <= 225;
  const nearWhite = r > 248 && g > 248 && b > 248;
  return checker || nearWhite;
}

function despill(r, g, b) {
  // 去绿边：边缘毛发常带绿溢色
  if (g > r + 8 && g > b + 8) {
    const over = Math.min(g - r, g - b);
    g = Math.max(r, b, g - Math.round(over * 0.85));
  }
  return [r, Math.min(255, g), b];
}

function floodClearBackground(data, width, height) {
  const visited = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    const o = idx * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = data[o + 3];
    // 只沿绿幕/透明扩散，避免灰色毛发被当成棋盘吃掉
    if (a === 0 || isPureGreen(r, g, b)) {
      visited[idx] = 1;
      data[o + 3] = 0;
      stack.push(idx);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % width;
    const y = (idx - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

async function keyBuffer(data, width, height, { keepLargest = true } = {}) {
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (isPureGreen(r, g, b)) {
      data[o + 3] = 0;
    } else {
      const [nr, ng, nb] = despill(r, g, b);
      data[o] = nr;
      data[o + 1] = ng;
      data[o + 2] = nb;
      data[o + 3] = 255;
    }
  }
  floodClearBackground(data, width, height);
  if (keepLargest) keepLargestComponent(data, width, height);
  softEdgeAlpha(data, width, height);
  return { data, width, height };
}

function keepLargestComponent(data, width, height) {
  const seen = new Uint8Array(width * height);
  let best = [];
  for (let i = 0; i < width * height; i++) {
    if (seen[i] || data[i * 4 + 3] < 16) continue;
    const q = [i];
    seen[i] = 1;
    const cells = [];
    while (q.length) {
      const cur = q.pop();
      cells.push(cur);
      const cx = cur % width;
      const cy = (cur - cx) / width;
      for (const [nx, ny] of [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (seen[n] || data[n * 4 + 3] < 16) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    if (cells.length > best.length) best = cells;
  }
  if (!best.length) throw new Error('no foreground');
  const keep = new Uint8Array(width * height);
  for (const i of best) keep[i] = 1;
  // 也保留与最大域很近的中小碎片（毛发）
  for (let i = 0; i < width * height; i++) {
    if (keep[i] || data[i * 4 + 3] < 16) {
      if (!keep[i]) data[i * 4 + 3] = 0;
      continue;
    }
    const x = i % width;
    const y = (i - x) / width;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (keep[ny * width + nx]) {
          near = true;
          break;
        }
      }
    }
    if (!near) data[i * 4 + 3] = 0;
  }
}

function softEdgeAlpha(data, width, height) {
  // 边缘轻微羽化，毛发更自然
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = data[i * 4 + 3];
  const out = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = alpha[i];
      if (a === 0 || a === 255) {
        // 边界附近才平滑
        let border = false;
        for (let dy = -1; dy <= 1 && !border; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (alpha[(y + dy) * width + (x + dx)] !== a) border = true;
          }
        }
        if (!border) {
          out[i] = a;
          continue;
        }
      }
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += alpha[(y + dy) * width + (x + dx)];
          n++;
        }
      }
      out[i] = Math.round(sum / n);
    }
  }
  for (let x = 0; x < width; x++) {
    out[x] = alpha[x];
    out[(height - 1) * width + x] = alpha[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    out[y * width] = alpha[y * width];
    out[y * width + width - 1] = alpha[y * width + width - 1];
  }
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = out[i];
}

async function loadRgba(inputPath) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: Buffer.from(data), width: info.width, height: info.height };
}

function tightCrop(data, width, height, pad = 8) {
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) throw new Error('no foreground: crop failed');
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

async function saveCropped(data, width, height, outPath) {
  const crop = tightCrop(data, width, height);
  await sharp(data, { raw: { width, height, channels: 4 } })
    .extract(crop)
    .png()
    .toFile(outPath);
  return crop;
}

async function processStill(inputPath, outPath) {
  const rgba = await loadRgba(inputPath);
  await keyBuffer(rgba.data, rgba.width, rgba.height, { keepLargest: true });
  const crop = await saveCropped(rgba.data, rgba.width, rgba.height, outPath);
  console.log('still', path.basename(outPath), crop.width, 'x', crop.height);
  return crop;
}

async function splitSheet(sheetPath, outDir, prefix, frames = 4) {
  const rgba = await loadRgba(sheetPath);
  const { data, width, height } = rgba;
  const frameW = Math.floor(width / frames);
  fs.mkdirSync(outDir, { recursive: true });
  const paths = [];
  for (let f = 0; f < frames; f++) {
    const left = f * frameW;
    const slice = Buffer.alloc(frameW * height * 4);
    for (let y = 0; y < height; y++) {
      data.copy(
        slice,
        y * frameW * 4,
        (y * width + left) * 4,
        (y * width + left) * 4 + frameW * 4
      );
    }
    // 每帧单独抠图，避免整表只留一只猫
    await keyBuffer(slice, frameW, height, { keepLargest: true });
    const outPath = path.join(outDir, `${prefix}_raw_${f + 1}.png`);
    await saveCropped(slice, frameW, height, outPath);
    paths.push(outPath);
  }
  return paths;
}

async function unify(framePaths, outDir, prefix) {
  let maxW = 0,
    maxH = 0;
  for (const p of framePaths) {
    const m = await sharp(p).metadata();
    maxW = Math.max(maxW, m.width);
    maxH = Math.max(maxH, m.height);
  }
  const outs = [];
  for (let i = 0; i < framePaths.length; i++) {
    const outPath = path.join(outDir, `${prefix}_${i + 1}.png`);
    await sharp(framePaths[i])
      .resize({
        width: maxW,
        height: maxH,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        position: 'bottom',
      })
      .png()
      .toFile(outPath);
    outs.push(outPath);
    console.log('frame', path.basename(outPath), maxW, maxH);
  }
  return { paths: outs, width: maxW, height: maxH };
}

async function unifyPair(a, b, outA, outB) {
  const ma = await sharp(a).metadata();
  const mb = await sharp(b).metadata();
  const w = Math.max(ma.width, mb.width);
  const h = Math.max(ma.height, mb.height);
  await sharp(a)
    .resize({
      width: w,
      height: h,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      position: 'bottom',
    })
    .png()
    .toFile(outA);
  await sharp(b)
    .resize({
      width: w,
      height: h,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      position: 'bottom',
    })
    .png()
    .toFile(outB);
  console.log('idle/blink unified', w, h);
  return { width: w, height: h };
}

async function main() {
  const idleSrc = path.join(assets, 'cat-idle-green.png');
  const blinkSrc = path.join(assets, 'cat-blink-source.png');
  const runV3 = path.join(assets, 'cat-run-v3.png');
  const runClean = path.join(assets, 'cat-run-clean.png');
  const butterflySheet = path.join(assets, 'cat-butterfly.png');
  const blinkSeqSheet = path.join(assets, 'cat-blink-seq.png');
  const runDir = path.join(assets, 'run');
  const butterflyDir = path.join(assets, 'butterfly');
  const blinkDir = path.join(assets, 'blink');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(butterflyDir, { recursive: true });
  fs.mkdirSync(blinkDir, { recursive: true });

  await processStill(idleSrc, path.join(assets, 'cat-idle-raw.png'));
  await processStill(blinkSrc, path.join(assets, 'cat-blink-raw.png'));
  const size = await unifyPair(
    path.join(assets, 'cat-idle-raw.png'),
    path.join(assets, 'cat-blink-raw.png'),
    path.join(assets, 'cat.png'),
    path.join(assets, 'cat-blink.png')
  );

  // 强制重切跑步帧（修复白毛窟窿）
  let runPaths;
  try {
    runPaths = await splitSheet(
      fs.existsSync(runV3) ? runV3 : runClean,
      runDir,
      'run',
      4
    );
  } catch (e) {
    console.warn('run sheet failed', e.message);
    runPaths = await splitSheet(runClean, runDir, 'run', 4);
  }
  const unified = await unify(runPaths, runDir, 'run');

  // 抓蝴蝶
  let butterfly = { paths: [], width: 0, height: 0 };
  try {
    const raw = await splitSheet(butterflySheet, butterflyDir, 'bf', 4);
    butterfly = await unify(raw, butterflyDir, 'bf');
  } catch (e) {
    console.warn('butterfly failed', e.message);
  }

  // 细腻眨眼序列 open -> half -> closed
  let blinkSeq = { paths: [], width: 0, height: 0 };
  try {
    const raw = await splitSheet(blinkSeqSheet, blinkDir, 'bk', 3);
    blinkSeq = await unify(raw, blinkDir, 'bk');
  } catch (e) {
    console.warn('blink seq failed', e.message);
  }

  const rel = (p) => path.relative(assets, p).replace(/\\/g, '/');
  fs.writeFileSync(
    path.join(assets, 'sprites.json'),
    JSON.stringify(
      {
        idle: 'cat.png',
        blink: 'cat-blink.png',
        idleSize: size,
        run: unified.paths.map(rel),
        runSize: { width: unified.width, height: unified.height },
        butterfly: butterfly.paths.map(rel),
        butterflySize: {
          width: butterfly.width,
          height: butterfly.height,
        },
        blinkSeq: blinkSeq.paths.map(rel),
        blinkSeqSize: {
          width: blinkSeq.width,
          height: blinkSeq.height,
        },
      },
      null,
      2
    )
  );
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
