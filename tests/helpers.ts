import type { Heightmap } from '../src/terrain';

/** テスト用の合成地形。f(col, row) で標高を決める */
export function makeHeightmap(
  size: number,
  f: (col: number, row: number) => number,
  opts: { metersPerPixel?: number; margin?: number } = {},
): Heightmap {
  const margin = opts.margin ?? Math.floor(size / 4);
  const data = new Float32Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) data[r * size + c] = f(c, r);
  return {
    width: size,
    height: size,
    data,
    metersPerPixel: opts.metersPerPixel ?? 10,
    mapRect: { col0: margin, row0: margin, size: size - 2 * margin },
    label: 'test',
  };
}

/** 中心 (cx, cy) が頂上の円錐 */
export function cone(cx: number, cy: number, peak: number, slopePerCell: number) {
  return (c: number, r: number) => peak - Math.hypot(c - cx, r - cy) * slopePerCell;
}
