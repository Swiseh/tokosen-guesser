import { contours } from 'd3-contour';
import type { Heightmap } from './terrain';
import { heightAt } from './terrain';

/** 1本の標高値の等高線。複数の閉曲線（リング）をまとめて平坦な配列で持つ（Worker から転送しやすい形） */
export interface ContourLevel {
  value: number;
  /** 計曲線（主曲線5本ごと）か */
  isIndex: boolean;
  /** 地図範囲の左上を原点としたグリッド座標 [x0, y0, x1, y1, ...] */
  coords: Float32Array;
  /** 各リングの開始位置（点の番号）。最後に総点数を入れる */
  ringStarts: Uint32Array;
}

export interface ContourData {
  interval: number;
  /** 地図範囲の一辺（グリッド数） */
  size: number;
  levels: ContourLevel[];
}

/** 表示範囲より少し広く計算し、端に閉じた線が出ないようにする */
const PAD = 2;

/** 地図範囲の等高線を計算する（重いので Worker で呼ぶ） */
export function computeContours(hm: Heightmap, interval: number): ContourData {
  const { col0, row0, size } = hm.mapRect;
  const gx0 = col0 - PAD;
  const gy0 = row0 - PAD;
  const n = size + 1 + 2 * PAD;
  const raw = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) raw[y * n + x] = heightAt(hm, gx0 + x, gy0 + y);
  const values = blur3(raw, n);

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const thresholds: number[] = [];
  for (let t = Math.ceil(min / interval) * interval; t <= max; t += interval) thresholds.push(t);

  const polys = contours().size([n, n]).smooth(true).thresholds(thresholds)(values as unknown as number[]);

  // d3-contour ではグリッド点 i が座標 i+0.5 に対応する。PAD 分と合わせて引き、地図範囲の左上を原点にする
  const off = PAD + 0.5;
  const indexEvery = interval * 5;
  return {
    interval,
    size,
    levels: polys.map((p) => {
      const rings = p.coordinates.flat();
      const total = rings.reduce((a, r) => a + r.length, 0);
      const coords = new Float32Array(total * 2);
      const ringStarts = new Uint32Array(rings.length + 1);
      let k = 0;
      rings.forEach((ring, i) => {
        ringStarts[i] = k;
        for (const [x, y] of ring) {
          coords[k * 2] = x - off;
          coords[k * 2 + 1] = y - off;
          k++;
        }
      });
      ringStarts[rings.length] = k;
      const q = p.value / indexEvery;
      return { value: p.value, isIndex: Math.abs(q - Math.round(q)) < 1e-6, coords, ringStarts };
    }),
  };
}

/** Worker から転送するバッファの一覧 */
export function contourTransferables(d: ContourData): ArrayBuffer[] {
  return d.levels.flatMap((l) => [l.coords.buffer as ArrayBuffer, l.ringStarts.buffer as ArrayBuffer]);
}

/** 3x3 の重み付き平滑化（端はそのまま）。グリッド単位のギザギザを抑える */
function blur3(src: Float64Array, n: number): Float64Array {
  const out = new Float64Array(src);
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      out[i] =
        (4 * src[i] +
          2 * (src[i - 1] + src[i + 1] + src[i - n] + src[i + n]) +
          (src[i - n - 1] + src[i - n + 1] + src[i + n - 1] + src[i + n + 1])) /
        16;
    }
  }
  return out;
}
