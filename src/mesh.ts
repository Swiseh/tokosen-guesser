import type { Heightmap } from './terrain';
import { heightAt } from './terrain';

/** 3Dメッシュの頂点データ（Worker から転送しやすいよう型付き配列のみ） */
export interface TerrainMeshData {
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
}

/**
 * ワールド座標の原点（地図範囲の中心）。
 * ワールド座標：x=東、z=南、y=標高 [m]。
 */
export function worldOrigin(hm: Heightmap) {
  return { col: hm.mapRect.col0 + hm.mapRect.size / 2, row: hm.mapRect.row0 + hm.mapRect.size / 2 };
}

/** グリッド座標 → ワールド座標の水平位置 [m] */
export function gridToWorld(hm: Heightmap, col: number, row: number) {
  const o = worldOrigin(hm);
  return { x: (col - o.col) * hm.metersPerPixel, z: (row - o.row) * hm.metersPerPixel };
}

/**
 * 標高データ全体を1枚のメッシュにする。法線は標高の中心差分で計算。
 * 四角形 a(c,r) b(c+1,r) c(c,r+1) d(c+1,r+1) を対角線 b-c で分割する（terrain.ts の sampleMeshHeight と一致させる）。
 */
export function buildTerrainMesh(hm: Heightmap): TerrainMeshData {
  const { width: W, height: H, metersPerPixel: mpp } = hm;
  const o = worldOrigin(hm);
  const positions = new Float32Array(W * H * 3);
  const normals = new Float32Array(W * H * 3);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      positions[i * 3] = (c - o.col) * mpp;
      positions[i * 3 + 1] = hm.data[i];
      positions[i * 3 + 2] = (r - o.row) * mpp;
      const dx = (heightAt(hm, c + 1, r) - heightAt(hm, c - 1, r)) / (2 * mpp);
      const dz = (heightAt(hm, c, r + 1) - heightAt(hm, c, r - 1)) / (2 * mpp);
      const len = Math.hypot(dx, 1, dz);
      normals[i * 3] = -dx / len;
      normals[i * 3 + 1] = 1 / len;
      normals[i * 3 + 2] = -dz / len;
    }
  }
  const index = new Uint32Array((W - 1) * (H - 1) * 6);
  let k = 0;
  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const a = r * W + c;
      const b = a + 1;
      const cc = a + W;
      const d = cc + 1;
      index[k++] = a;
      index[k++] = cc;
      index[k++] = b;
      index[k++] = b;
      index[k++] = cc;
      index[k++] = d;
    }
  }
  return { positions, normals, index };
}
