import { isValidSeed } from './random';
import { REGIONS } from './regions';

/**
 * 1セット（地図と5問）を再現するための指定。
 * 「セットコード」は `山域ID.シード` の文字列（例: kita-alps.k3j9x2ab）。
 * 同じコードなら同じ場所・同じ出題地点・同じ最初の向きになる。
 */
export interface SetSpec {
  regionId: string;
  seed: string;
}

export function formatSetCode(spec: SetSpec): string {
  return `${spec.regionId}.${spec.seed}`;
}

/** 不正なコード（存在しない山域、使えない文字）は null */
export function parseSetCode(code: string): SetSpec | null {
  const s = code.trim().toLowerCase();
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return null;
  const regionId = s.slice(0, dot);
  const seed = s.slice(dot + 1);
  if (!REGIONS.some((r) => r.id === regionId) || !isValidSeed(seed)) return null;
  return { regionId, seed };
}
