/**
 * 標高データ（ハイトマップ）。実地形でも生成地形でも、この形式を共通の受け渡し形式にする。
 * グリッド (col, row) は col が東向き、row が南向き。row-major で data[row * width + col]。
 */
export interface Heightmap {
  width: number;
  height: number;
  /** 標高 [m] */
  data: Float32Array;
  /** 1グリッドあたりの地上距離 [m] */
  metersPerPixel: number;
  /** 出題・表示に使う地図範囲（グリッド座標、外側は遠景用の余白） */
  mapRect: { col0: number; row0: number; size: number };
  /** 表示用のラベル（地域名など） */
  label: string;
  /** 地図範囲の中心の緯度経度（実地形のみ） */
  center?: { lat: number; lon: number };
}

/** グリッド点の標高（範囲外はクランプ） */
export function heightAt(hm: Heightmap, col: number, row: number): number {
  const c = Math.min(hm.width - 1, Math.max(0, col));
  const r = Math.min(hm.height - 1, Math.max(0, row));
  return hm.data[r * hm.width + c];
}

/**
 * 3Dメッシュと同じ三角形分割で補間した標高。
 * カメラ高さをメッシュ表面と厳密に一致させるために使う（地面にめり込まないように）。
 * 四角形 a(0,0) b(1,0) c(0,1) d(1,1) を対角線 b-c で分割している前提。
 */
export function sampleMeshHeight(hm: Heightmap, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = heightAt(hm, x0, y0);
  const b = heightAt(hm, x0 + 1, y0);
  const c = heightAt(hm, x0, y0 + 1);
  const d = heightAt(hm, x0 + 1, y0 + 1);
  if (fx + fy <= 1) return a + fx * (b - a) + fy * (c - a);
  return d + (1 - fx) * (c - d) + (1 - fy) * (b - d);
}
