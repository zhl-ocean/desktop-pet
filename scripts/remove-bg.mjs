/**
 * 使用 U2NetP ONNX 模型抠图
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const inputPath = path.join(root, 'assets', 'cat-original.png');
const outputPath = path.join(root, 'assets', 'cat.png');
const modelPath = path.join(root, 'models', 'u2netp.onnx');

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const SIZE = 320;

async function main() {
  if (!fs.existsSync(inputPath)) throw new Error(`找不到原图: ${inputPath}`);
  if (!fs.existsSync(modelPath)) throw new Error(`找不到模型: ${modelPath}`);

  const meta = await sharp(inputPath).metadata();
  const srcW = meta.width;
  const srcH = meta.height;

  const { data } = await sharp(inputPath)
    .removeAlpha()
    .resize(SIZE, SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let maxv = 1;
  for (const v of data) if (v > maxv) maxv = v;

  const input = new Float32Array(1 * 3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = data[i * 3] / maxv;
    const g = data[i * 3 + 1] / maxv;
    const b = data[i * 3 + 2] / maxv;
    input[i] = (r - MEAN[0]) / STD[0];
    input[SIZE * SIZE + i] = (g - MEAN[1]) / STD[1];
    input[2 * SIZE * SIZE + i] = (b - MEAN[2]) / STD[2];
  }

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
  });
  // rembg 使用第一个输出作为主 saliency map
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const results = await session.run({
    [inputName]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]),
  });
  const plane = results[outputName].data;

  const mask320 = Buffer.alloc(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    // 保留毛发边缘，同时压掉背景
    let a = plane[i];
    if (a < 0.12) a = 0;
    else if (a > 0.45) a = 1;
    else a = (a - 0.12) / 0.33;
    mask320[i] = Math.round(a * 255);
  }

  // 去掉小连通域噪点（保留最大前景）
  {
    const visited = new Uint8Array(SIZE * SIZE);
    const sizes = [];
    const labels = new Int32Array(SIZE * SIZE).fill(-1);
    let label = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (visited[i] || mask320[i] < 20) continue;
      const q = [i];
      visited[i] = 1;
      labels[i] = label;
      let count = 0;
      while (q.length) {
        const cur = q.pop();
        count++;
        const x = cur % SIZE;
        const y = (cur - x) / SIZE;
        const neigh = [cur + 1, cur - 1, cur + SIZE, cur - SIZE];
        for (const n of neigh) {
          if (n < 0 || n >= SIZE * SIZE) continue;
          const nx = n % SIZE;
          const ny = (n - nx) / SIZE;
          if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
          if (visited[n] || mask320[n] < 20) continue;
          visited[n] = 1;
          labels[n] = label;
          q.push(n);
        }
      }
      sizes[label] = count;
      label++;
    }
    let best = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (labels[i] !== -1 && labels[i] !== best) mask320[i] = 0;
    }
  }

  const maskFull = await sharp(mask320, {
    raw: { width: SIZE, height: SIZE, channels: 1 },
  })
    .resize(srcW, srcH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .toColourspace('b-w')
    .raw()
    .toBuffer();

  // 轻微羽化：3x3 平均，仅作用于边缘
  const feathered = Buffer.alloc(srcW * srcH);
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const i = y * srcW + x;
      const v = maskFull[i];
      if (v === 0 || v === 255) {
        feathered[i] = v;
        continue;
      }
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= srcW || ny >= srcH) continue;
          sum += maskFull[ny * srcW + nx];
          count++;
        }
      }
      feathered[i] = Math.round(sum / count);
    }
  }

  const rgba = await sharp(inputPath).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < srcW * srcH; i++) {
    rgba[i * 4 + 3] = feathered[i];
  }

  let minX = srcW;
  let minY = srcH;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      if (rgba[(y * srcW + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX) throw new Error('抠图失败：未检测到前景');

  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(srcW - 1, maxX + pad);
  maxY = Math.min(srcH - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  await sharp(rgba, { raw: { width: srcW, height: srcH, channels: 4 } })
    .extract({ left: minX, top: minY, width: w, height: h })
    .png()
    .toFile(outputPath);

  console.log(`已生成透明角色图: ${outputPath} (${w}x${h})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
