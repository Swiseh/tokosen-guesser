import { describe, expect, it } from 'vitest';
import { computeContours } from '../src/contours';
import { cone, makeHeightmap } from './helpers';

describe('computeContours', () => {
  // 100x100 の地形、地図範囲は (20,20) から 60x60。頂上は (50, 45)
  const hm = makeHeightmap(100, cone(50, 45, 1000, 5), { margin: 20 });
  const data = computeContours(hm, 10);

  it('間隔ごとの等高線ができ、5本ごとに計曲線になる', () => {
    expect(data.interval).toBe(10);
    expect(data.size).toBe(60);
    const values = data.levels.map((l) => l.value);
    expect(values.every((v) => v % 10 === 0)).toBe(true);
    for (const l of data.levels) expect(l.isIndex).toBe(l.value % 50 === 0);
  });

  it('円錐の等高線は頂上を中心とした円になる（座標のずれがない）', () => {
    // 標高 900m の等高線 = 頂上から半径 20 セルの円。地図範囲の原点は (20,20) なので中心は (30, 25)
    const level = data.levels.find((l) => l.value === 900)!;
    expect(level).toBeDefined();
    const n = level.coords.length / 2;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += level.coords[i * 2];
      sy += level.coords[i * 2 + 1];
    }
    expect(sx / n).toBeCloseTo(30, 0);
    expect(sy / n).toBeCloseTo(25, 0);
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(level.coords[i * 2] - 30, level.coords[i * 2 + 1] - 25);
      expect(Math.abs(r - 20)).toBeLessThan(0.6);
    }
  });

  it('リングの区切りが点の数と整合している', () => {
    for (const l of data.levels) {
      expect(l.ringStarts[0]).toBe(0);
      expect(l.ringStarts[l.ringStarts.length - 1]).toBe(l.coords.length / 2);
    }
  });
});
