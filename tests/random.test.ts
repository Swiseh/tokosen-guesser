import { describe, expect, it } from 'vitest';
import { createRng, isValidSeed, mulberry32, newSeed, SEED_LENGTH } from '../src/random';

describe('random', () => {
  it('同じシードなら同じ列になる', () => {
    const a = createRng('abc', 'spots');
    const b = createRng('abc', 'spots');
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('用途名が違えば別の列になる', () => {
    const a = createRng('abc', 'spots');
    const b = createRng('abc', 'yaw');
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('値は 0 以上 1 未満', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('既知の値を返す（実装が変わるとセットコードの再現性が壊れるので固定する）', () => {
    const r = createRng('kita-alps-test', 'center');
    expect([r(), r()].map((v) => v.toFixed(10))).toMatchInlineSnapshot(`
      [
        "0.1378248252",
        "0.2398520494",
      ]
    `);
  });

  it('newSeed は有効なシードを作る', () => {
    for (let i = 0; i < 50; i++) {
      const s = newSeed();
      expect(s).toHaveLength(SEED_LENGTH);
      expect(isValidSeed(s)).toBe(true);
    }
  });

  it('紛らわしい文字や空文字はシードとして無効', () => {
    expect(isValidSeed('')).toBe(false);
    expect(isValidSeed('abc0')).toBe(false);
    expect(isValidSeed('abcl')).toBe(false);
    expect(isValidSeed('ABC')).toBe(false);
  });
});
