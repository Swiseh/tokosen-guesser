import { describe, expect, it } from 'vitest';
import { buildTerrainMesh, gridToWorld } from '../src/mesh';
import { heightAt, sampleMeshHeight } from '../src/terrain';
import { makeHeightmap } from './helpers';

describe('sampleMeshHeight', () => {
  const hm = makeHeightmap(8, (c, r) => (c * 7 + r * 13) % 11);

  it('グリッド点では元の標高と一致する', () => {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) expect(sampleMeshHeight(hm, c, r)).toBeCloseTo(heightAt(hm, c, r));
  });

  it('平面ならどこでも平面の値になる', () => {
    const plane = makeHeightmap(8, (c, r) => 100 + 2 * c - 3 * r);
    for (const [x, y] of [[1.2, 3.7], [4.9, 0.1], [6.5, 6.5]]) expect(sampleMeshHeight(plane, x, y)).toBeCloseTo(100 + 2 * x - 3 * y);
  });

  it('メッシュの三角形分割（対角線 b-c）と一致する', () => {
    // 四角形 (0,0)-(1,1) の a=0, b=0, c=0, d=10。対角線 b-c の上側の三角形 a,b,c は全部 0
    const m = makeHeightmap(2, (c, r) => (c === 1 && r === 1 ? 10 : 0), { margin: 0 });
    expect(sampleMeshHeight(m, 0.3, 0.3)).toBeCloseTo(0);
    expect(sampleMeshHeight(m, 0.5, 0.5)).toBeCloseTo(0);
    // 下側の三角形 b,c,d：d に向かって線形に上がる
    expect(sampleMeshHeight(m, 0.75, 0.75)).toBeCloseTo(5);
    expect(sampleMeshHeight(m, 1, 1)).toBeCloseTo(10);
  });

  it('範囲外はクランプされる', () => {
    expect(sampleMeshHeight(hm, -5, -5)).toBeCloseTo(heightAt(hm, 0, 0));
  });
});

describe('buildTerrainMesh', () => {
  it('頂点の位置がワールド座標の決まり（x=東, z=南, y=標高）に従う', () => {
    const hm = makeHeightmap(9, (c, r) => c + 10 * r, { metersPerPixel: 5, margin: 2 });
    const mesh = buildTerrainMesh(hm);
    const c = 7;
    const r = 3;
    const i = r * 9 + c;
    const w = gridToWorld(hm, c, r);
    expect(mesh.positions[i * 3]).toBeCloseTo(w.x);
    expect(mesh.positions[i * 3 + 1]).toBeCloseTo(c + 10 * r);
    expect(mesh.positions[i * 3 + 2]).toBeCloseTo(w.z);
    // 地図範囲の中心が原点
    expect(gridToWorld(hm, 4.5, 4.5)).toEqual({ x: 0, z: 0 });
  });

  it('三角形は上向き（法線が +y 側）', () => {
    const hm = makeHeightmap(4, () => 0, { margin: 0 });
    const { positions: p, index } = buildTerrainMesh(hm);
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
      const u = [p[b * 3] - p[a * 3], p[b * 3 + 2] - p[a * 3 + 2]];
      const v = [p[c * 3] - p[a * 3], p[c * 3 + 2] - p[a * 3 + 2]];
      // (b-a) × (c-a) の y 成分 = uz*vx - ux*vz
      expect(u[1] * v[0] - u[0] * v[1]).toBeGreaterThan(0);
    }
  });
});
