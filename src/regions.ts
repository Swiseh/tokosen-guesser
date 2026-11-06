/** 出題する山域のプリセット。中心から ±spread 度の範囲でランダムに地図の中心を選ぶ。 */
export interface Region {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** 中心をずらす最大量 [度] */
  spread: number;
}

export const REGIONS: Region[] = [
  { id: 'kita-alps', name: '北アルプス（槍・穂高）', lat: 36.3, lon: 137.65, spread: 0.12 },
  { id: 'tateyama', name: '北アルプス（立山・剱）', lat: 36.6, lon: 137.6, spread: 0.08 },
  { id: 'minami-alps', name: '南アルプス', lat: 35.6, lon: 138.2, spread: 0.12 },
  { id: 'yatsugatake', name: '八ヶ岳', lat: 35.97, lon: 138.37, spread: 0.06 },
  { id: 'okuchichibu', name: '奥秩父', lat: 35.86, lon: 138.75, spread: 0.08 },
  { id: 'tanzawa', name: '丹沢', lat: 35.47, lon: 139.15, spread: 0.05 },
  { id: 'daisetsu', name: '大雪山', lat: 43.66, lon: 142.86, spread: 0.08 },
  { id: 'hidaka', name: '日高山脈', lat: 42.75, lon: 142.7, spread: 0.12 },
  { id: 'shikoku', name: '四国山地（石鎚山）', lat: 33.77, lon: 133.12, spread: 0.08 },
  { id: 'kirishima', name: '霧島山', lat: 31.9, lon: 130.86, spread: 0.05 },
];

export function randomCenter(region: Region, rand: () => number = Math.random) {
  return {
    lat: region.lat + (rand() * 2 - 1) * region.spread,
    lon: region.lon + (rand() * 2 - 1) * region.spread,
  };
}
