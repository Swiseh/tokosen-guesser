import type { Heightmap } from './terrain';
import type { Rng } from './random';
import { sampleMeshHeight } from './terrain';

export interface Spot {
  col: number;
  row: number;
  /** 見通しの良さ（0〜1） */
  score: number;
}

/**
 * 地点からの見通しの良さ。360°に光線を飛ばし、見える地面の面積の割合を返す。
 * 遠くの地面ほど面積が大きいので距離で重み付けする。
 */
export function visibilityScore(hm: Heightmap, col: number, row: number, eyeHeight = 1.7, maxDistM = 3000): number {
  const perRay = rayVisibility(hm, col, row, eyeHeight, maxDistM);
  return perRay.reduce((a, b) => a + b, 0) / perRay.length;
}

/**
 * 出題時の最初の向き。見通しの良い方向（上位 1/4）からランダムに選ぶ。
 * 目の前が斜面で何も見えない、という出だしを避けるため。
 */
export function initialYaw(hm: Heightmap, col: number, row: number, rand: Rng): number {
  const perRay = rayVisibility(hm, col, row);
  const order = perRay.map((v, k) => ({ v, k })).sort((a, b) => b.v - a.v);
  const pick = order[Math.floor(rand() * Math.ceil(order.length / 4))];
  const yaw = ((pick.k + rand() - 0.5) / perRay.length) * Math.PI * 2;
  return (yaw + Math.PI * 2) % (Math.PI * 2);
}

/** 方向ごとの「見える地面の割合」（北=0 から時計回りに 64 方向） */
function rayVisibility(hm: Heightmap, col: number, row: number, eyeHeight = 1.7, maxDistM = 3000): number[] {
  const mpp = hm.metersPerPixel;
  const eye = sampleMeshHeight(hm, col, row) + eyeHeight;
  const rays = 64;
  const stepPx = 2;
  const steps = Math.floor(maxDistM / mpp / stepPx);
  const result: number[] = [];
  for (let k = 0; k < rays; k++) {
    let visible = 0;
    let total = 0;
    const a = (k / rays) * Math.PI * 2;
    const dx = Math.sin(a) * stepPx;
    const dy = -Math.cos(a) * stepPx;
    let maxSlope = -Infinity;
    for (let s = 1; s <= steps; s++) {
      const c = col + dx * s;
      const r = row + dy * s;
      if (c < 0 || r < 0 || c >= hm.width - 1 || r >= hm.height - 1) break;
      const d = s * stepPx * mpp;
      const slope = (sampleMeshHeight(hm, c, r) - eye) / d;
      total += d;
      if (slope >= maxSlope) {
        visible += d;
        maxSlope = slope;
      }
    }
    result.push(total > 0 ? visible / total : 0);
  }
  return result;
}

/**
 * 出題地点を n 個選ぶ。ランダムな候補のうち見通しの良い上位半分から、互いに離れた地点を選ぶ。
 */
export function pickSpots(hm: Heightmap, n: number, rand: Rng): Spot[] {
  const { col0, row0, size } = hm.mapRect;
  const inset = size * 0.06; // 地図の端ぎりぎりは避ける
  const candidates: Spot[] = [];
  for (let i = 0; i < 120; i++) {
    const col = col0 + inset + rand() * (size - 2 * inset);
    const row = row0 + inset + rand() * (size - 2 * inset);
    candidates.push({ col, row, score: visibilityScore(hm, col, row) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const pool = candidates.slice(0, Math.ceil(candidates.length / 2));

  const minDistPx = size * 0.18;
  const chosen: Spot[] = [];
  while (pool.length > 0 && chosen.length < n) {
    const s = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    if (chosen.every((c) => Math.hypot(c.col - s.col, c.row - s.row) >= minDistPx)) chosen.push(s);
  }
  // 離れた地点が足りなければ距離条件なしで補う
  for (const s of candidates) {
    if (chosen.length >= n) break;
    if (!chosen.includes(s)) chosen.push(s);
  }
  return chosen;
}

/** 距離 [m] からスコア（最大 5000） */
export function scoreForDistance(distM: number, mapSizeM: number): number {
  return Math.round(5000 * Math.exp(-distM / (mapSizeM / 8)));
}
