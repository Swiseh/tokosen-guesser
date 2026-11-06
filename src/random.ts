/** 0 以上 1 未満の乱数を返す関数。Math.random と同じ形 */
export type Rng = () => number;

/** 文字列 → 32bit ハッシュ（FNV-1a） */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** シード付き乱数（mulberry32）。同じシードなら、どのブラウザでも同じ列になる */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * シードと用途名から乱数を作る。用途ごとに独立した列にしておくと、
 * 片方の処理で乱数を使う回数が変わっても、もう片方の結果は変わらない。
 */
export function createRng(seed: string, stream: string): Rng {
  return mulberry32(hashString(`${seed}/${stream}`));
}

/** 読み間違えにくい文字だけを使う（0/o, 1/l/i を除く） */
const SEED_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export const SEED_LENGTH = 8;

export function newSeed(rand: Rng = Math.random): string {
  let s = '';
  for (let i = 0; i < SEED_LENGTH; i++) s += SEED_CHARS[Math.floor(rand() * SEED_CHARS.length)];
  return s;
}

export function isValidSeed(s: string): boolean {
  return s.length > 0 && s.length <= 32 && [...s].every((c) => SEED_CHARS.includes(c));
}
