import { describe, expect, it } from 'vitest';
import { formatSetCode, parseSetCode } from '../src/setCode';

describe('setCode', () => {
  it('書き出したコードを読み戻せる', () => {
    const spec = { regionId: 'kita-alps', seed: 'k3j9x2ab' };
    expect(parseSetCode(formatSetCode(spec))).toEqual(spec);
  });

  it('前後の空白と大文字を許容する', () => {
    expect(parseSetCode('  Kita-Alps.K3J9X2AB ')).toEqual({ regionId: 'kita-alps', seed: 'k3j9x2ab' });
  });

  it('不正なコードは null', () => {
    expect(parseSetCode('')).toBeNull();
    expect(parseSetCode('kita-alps')).toBeNull();
    expect(parseSetCode('no-such-region.abcd')).toBeNull();
    expect(parseSetCode('kita-alps.')).toBeNull();
    expect(parseSetCode('kita-alps.abc0')).toBeNull();
  });
});
