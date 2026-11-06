import type { ContourData } from './contours';
import type { PrepareParams, PreparedSet } from './prepare';

/** 本体 → Worker */
export type WorkerRequest =
  | { type: 'prepare'; id: number; params: PrepareParams }
  | { type: 'contours'; id: number; interval: number }
  | { type: 'cancel'; id: number };

/** Worker → 本体 */
export type WorkerResponse =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'prepared'; id: number; set: PreparedSet }
  | { type: 'contours'; id: number; contours: ContourData }
  | { type: 'error'; id: number; message: string };
