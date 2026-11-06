/**
 * 難易度（レベル）。出題中の 3D ビューの操作と、標高計の有無を決める。
 * どのレベルでもその場から移動はできない。
 */
export type LevelId = 'nm' | 'nmpz' | 'nmpzh';

export interface Level {
  id: LevelId;
  name: string;
  description: string;
  /** ドラッグで見回せるか */
  canPan: boolean;
  /** ホイールで拡大・縮小できるか */
  canZoom: boolean;
  /** 標高計を表示するか */
  altimeter: boolean;
}

export const LEVELS: Level[] = [
  {
    id: 'nm',
    name: 'No Move',
    description: '見回し・ズームができる。移動はできない',
    canPan: true,
    canZoom: true,
    altimeter: true,
  },
  {
    id: 'nmpz',
    name: 'NMPZ',
    description: '見回しもズームもできない。最初の視界だけで当てる',
    canPan: false,
    canZoom: false,
    altimeter: true,
  },
  {
    id: 'nmpzh',
    name: 'NMPZH',
    description: 'NMPZ に加えて標高計もなし。景色と地図だけが頼り',
    canPan: false,
    canZoom: false,
    altimeter: false,
  },
];

export function findLevel(id: string | null | undefined): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}
