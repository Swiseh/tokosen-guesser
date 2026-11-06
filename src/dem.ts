import type { Heightmap } from './terrain';

/**
 * 国土地理院 標高タイル（DEM10B, PNG形式）から標高データを作る。
 * https://maps.gsi.go.jp/development/ichiran.html#dem
 * タイルはブラウザで実行時に読み込むだけにし、保存・再配布はしない。
 */
const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png';
const ZOOM = 14; // DEM10B の最大ズーム
const TILE = 256;
const EARTH_R = 6378137;

export interface LoadOptions {
  /** 出題・表示する地図の一辺 [m] */
  mapSizeMeters: number;
  /** 地図の外側に読み込む余白 [m]（3Dの遠景用。地図の端が見えないようにする） */
  marginMeters: number;
  onProgress?: (done: number, total: number) => void;
}

/** 緯度経度 → ズーム z の全球ピクセル座標（Web メルカトル） */
export function lonLatToPixel(lon: number, lat: number, z: number) {
  const n = TILE * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

export function pixelToLonLat(x: number, y: number, z: number) {
  const n = TILE * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}

/** 標高PNGの1ピクセルを標高 [m] に変換。無効値（海・欠損）は NaN */
export function decodePixel(r: number, g: number, b: number): number {
  const v = (r << 16) | (g << 8) | b;
  if (v === 0x800000) return NaN;
  return (v < 0x800000 ? v : v - 0x1000000) * 0.01;
}

async function fetchTile(x: number, y: number, z: number, signal?: AbortSignal): Promise<Float32Array | null> {
  const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url, { signal });
  if (res.status === 404) return null; // 海域などデータのないタイル
  if (!res.ok) throw new Error(`標高タイルの取得に失敗しました (${res.status}): ${url}`);
  const bmp = await createImageBitmap(await res.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, TILE, TILE).data;
  const out = new Float32Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) out[i] = decodePixel(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  return out;
}

/** 同時接続数を制限して並列実行 */
async function runLimited<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** 指定した緯度経度を中心とする実地形の標高データを読み込む */
export async function loadRealTerrain(
  lat: number,
  lon: number,
  label: string,
  opts: LoadOptions,
  signal?: AbortSignal,
): Promise<Heightmap> {
  const mpp = (2 * Math.PI * EARTH_R * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** ZOOM);
  const mapPx = Math.round(opts.mapSizeMeters / mpp);
  const marginPx = Math.round(opts.marginMeters / mpp);
  const size = mapPx + 2 * marginPx;

  const c = lonLatToPixel(lon, lat, ZOOM);
  const gx0 = Math.floor(c.x - size / 2);
  const gy0 = Math.floor(c.y - size / 2);
  const tx0 = Math.floor(gx0 / TILE);
  const ty0 = Math.floor(gy0 / TILE);
  const tx1 = Math.floor((gx0 + size - 1) / TILE);
  const ty1 = Math.floor((gy0 + size - 1) / TILE);

  const coords: { tx: number; ty: number }[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) coords.push({ tx, ty });

  let done = 0;
  opts.onProgress?.(0, coords.length);
  const tiles = await runLimited(
    coords.map(({ tx, ty }) => async () => {
      const t = await fetchTile(tx, ty, ZOOM, signal);
      opts.onProgress?.(++done, coords.length);
      return t;
    }),
    8,
  );

  const data = new Float32Array(size * size);
  let nanCount = 0;
  for (let row = 0; row < size; row++) {
    const gy = gy0 + row;
    const ty = Math.floor(gy / TILE);
    const py = gy - ty * TILE;
    for (let col = 0; col < size; col++) {
      const gx = gx0 + col;
      const tx = Math.floor(gx / TILE);
      const pxl = gx - tx * TILE;
      const tile = tiles[(ty - ty0) * (tx1 - tx0 + 1) + (tx - tx0)];
      let h = tile ? tile[py * TILE + pxl] : NaN;
      if (Number.isNaN(h)) {
        h = 0; // 海・欠損は標高0とする（試作では水面表現なし）
        nanCount++;
      }
      data[row * size + col] = h;
    }
  }
  if (nanCount > 0) console.info(`標高データの欠損 ${nanCount} 点を 0m としました`);

  const centerLL = pixelToLonLat(gx0 + size / 2, gy0 + size / 2, ZOOM);
  return {
    width: size,
    height: size,
    data,
    metersPerPixel: mpp,
    mapRect: { col0: marginPx, row0: marginPx, size: mapPx },
    label,
    center: { lat: centerLL.lat, lon: centerLL.lon },
  };
}
