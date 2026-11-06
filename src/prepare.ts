import { computeContours, type ContourData } from './contours';
import { loadRealTerrain } from './dem';
import type { Question } from './game';
import { buildTerrainMesh, type TerrainMeshData } from './mesh';
import { createRng } from './random';
import { findRegion, randomCenter } from './regions';
import type { SetSpec } from './setCode';
import { initialYaw, pickSpots } from './spots';
import type { Heightmap } from './terrain';

export interface PrepareParams {
  spec: SetSpec;
  mapSizeMeters: number;
  marginMeters: number;
  questions: number;
  /** 最初に計算する等高線の間隔 [m] */
  interval: number;
}

/** 1セットを遊ぶのに必要なものすべて */
export interface PreparedSet {
  spec: SetSpec;
  hm: Heightmap;
  mesh: TerrainMeshData;
  contours: ContourData;
  questions: Question[];
}

/**
 * セットコードから、地形の読み込み・出題地点・メッシュ・等高線までをまとめて用意する。
 * 乱数はすべてシードから作るので、同じコードなら同じ結果になる。
 * Worker 内で呼ぶ想定だが、DOM には依存しない。
 */
export async function prepareSet(
  p: PrepareParams,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<PreparedSet> {
  const region = findRegion(p.spec.regionId);
  if (!region) throw new Error(`不明な山域です: ${p.spec.regionId}`);
  const center = randomCenter(region, createRng(p.spec.seed, 'center'));
  const hm = await loadRealTerrain(
    center.lat,
    center.lon,
    region.name,
    { mapSizeMeters: p.mapSizeMeters, marginMeters: p.marginMeters, onProgress },
    signal,
  );
  const spots = pickSpots(hm, p.questions, createRng(p.spec.seed, 'spots'));
  const yawRng = createRng(p.spec.seed, 'yaw');
  const questions = spots.map((s) => ({ col: s.col, row: s.row, yaw: initialYaw(hm, s.col, s.row, yawRng) }));
  return {
    spec: p.spec,
    hm,
    mesh: buildTerrainMesh(hm),
    contours: computeContours(hm, p.interval),
    questions,
  };
}
