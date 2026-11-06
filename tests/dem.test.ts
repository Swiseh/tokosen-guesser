import { describe, expect, it } from 'vitest';
import { decodePixel, lonLatToPixel, pixelToLonLat } from '../src/dem';

describe('decodePixel（地理院 標高PNG）', () => {
  it('0.01m 単位の標高を読む', () => {
    expect(decodePixel(0, 0, 0)).toBe(0);
    expect(decodePixel(0, 0, 100)).toBeCloseTo(1);
    // 3180.81 m = 318081 = 0x04_DA_81
    expect(decodePixel(0x04, 0xda, 0x81)).toBeCloseTo(3180.81);
  });

  it('2^23 は無効値（NaN）', () => {
    expect(decodePixel(128, 0, 0)).toBeNaN();
  });

  it('2^23 より大きい値は負の標高', () => {
    // -1.00 m = 2^24 - 100
    const v = 0x1000000 - 100;
    expect(decodePixel(v >> 16, (v >> 8) & 0xff, v & 0xff)).toBeCloseTo(-1);
  });
});

describe('タイル座標の変換', () => {
  it('緯度経度 ↔ ピクセル座標が往復で一致する', () => {
    for (const [lon, lat] of [[137.6476, 36.342], [142.86, 43.66], [130.86, 31.9]]) {
      const p = lonLatToPixel(lon, lat, 14);
      const back = pixelToLonLat(p.x, p.y, 14);
      expect(back.lon).toBeCloseTo(lon, 9);
      expect(back.lat).toBeCloseTo(lat, 9);
    }
  });

  it('槍ヶ岳はズーム14のタイル (14456, 6414) に入る', () => {
    const p = lonLatToPixel(137.6476, 36.342, 14);
    expect(Math.floor(p.x / 256)).toBe(14456);
    expect(Math.floor(p.y / 256)).toBe(6414);
  });
});
