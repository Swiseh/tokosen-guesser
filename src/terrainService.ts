import type { ContourData } from './contours';
import type { PrepareParams, PreparedSet } from './prepare';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

interface Pending {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Worker を Promise で呼べるようにする窓口。
 * 新しいセットの準備を始めると、前の準備は中断（AbortError で reject）される。
 */
export class TerrainService {
  private worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private activePrepare: number | null = null;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        p.onProgress?.(msg.done, msg.total);
        return;
      }
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else if (msg.type === 'prepared') (p.resolve as (v: PreparedSet) => void)(msg.set);
      else if (msg.type === 'contours') (p.resolve as (v: ContourData) => void)(msg.contours);
    };
  }

  prepare(params: PrepareParams, onProgress?: (done: number, total: number) => void): Promise<PreparedSet> {
    if (this.activePrepare !== null) this.cancel(this.activePrepare);
    const id = this.nextId++;
    this.activePrepare = id;
    return this.request<PreparedSet>({ type: 'prepare', id, params }, onProgress).finally(() => {
      if (this.activePrepare === id) this.activePrepare = null;
    });
  }

  contours(interval: number): Promise<ContourData> {
    return this.request<ContourData>({ type: 'contours', id: this.nextId++, interval });
  }

  private cancel(id: number) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.worker.postMessage({ type: 'cancel', id } satisfies WorkerRequest);
    p.reject(new DOMException('中断しました', 'AbortError'));
  }

  private request<T>(req: WorkerRequest, onProgress?: (done: number, total: number) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req.id, { resolve: resolve as (v: never) => void, reject, onProgress });
      this.worker.postMessage(req);
    });
  }
}
