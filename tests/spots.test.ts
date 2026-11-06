import { describe, expect, it } from 'vitest';
import { createRng } from '../src/random';
import { initialYaw, pickSpots, scoreForDistance, visibilityScore } from '../src/spots';
import { cone, makeHeightmap } from './helpers';

describe('scoreForDistance', () => {
  it('誤差 0 で満点、遠いほど下がる', () => {
    expect(scoreForDistance(0, 4000)).toBe(5000);
    expect(scoreForDistance(100, 4000)).toBeGreaterThan(scoreForDistance(500, 4000));
    expect(scoreForDistance(10000, 4000)).toBe(0);
  });
});

describe('出題地点', () => {
  // 起伏のある地形：円錐を2つ重ねる
  const a = cone(80, 70, 1500, 6);
  const b = cone(140, 130, 1300, 5);
  const hm = makeHeightmap(200, (c, r) => Math.max(a(c, r), b(c, r), 200), { margin: 40, metersPerPixel: 10 });

  it('頂上は谷底より見通しが良い', () => {
    expect(visibilityScore(hm, 80, 70)).toBeGreaterThan(visibilityScore(hm, 110, 100));
  });

  it('同じシードなら同じ地点が選ばれる', () => {
    const s1 = pickSpots(hm, 5, createRng('seed1', 'spots'));
    const s2 = pickSpots(hm, 5, createRng('seed1', 'spots'));
    expect(s1).toEqual(s2);
    const s3 = pickSpots(hm, 5, createRng('seed2', 'spots'));
    expect(s3).not.toEqual(s1);
  });

  it('指定した数だけ、地図範囲の内側から選ばれる', () => {
    const spots = pickSpots(hm, 5, createRng('x', 'spots'));
    expect(spots).toHaveLength(5);
    const { col0, row0, size } = hm.mapRect;
    for (const s of spots) {
      expect(s.col).toBeGreaterThanOrEqual(col0);
      expect(s.col).toBeLessThanOrEqual(col0 + size);
      expect(s.row).toBeGreaterThanOrEqual(row0);
      expect(s.row).toBeLessThanOrEqual(row0 + size);
    }
  });

  it('最初の向きは 0 以上 2π 未満', () => {
    const rng = createRng('y', 'yaw');
    for (let i = 0; i < 50; i++) {
      const yaw = initialYaw(hm, 100, 100, rng);
      expect(yaw).toBeGreaterThanOrEqual(0);
      expect(yaw).toBeLessThan(Math.PI * 2);
    }
  });
});
