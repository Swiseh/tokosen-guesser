import { computeContours, contourTransferables } from './contours';
import { prepareSet } from './prepare';
import type { Heightmap } from './terrain';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

/**
 * 重い処理（タイル取得とデコード、出題地点の選定、メッシュ・等高線の計算）を担当する Worker。
 * 直近に用意した標高データを持っておき、等高線の間隔を変えたときの再計算に使う。
 */
// tsconfig は DOM 用の型なので、Worker のグローバルは必要な分だけ型を付ける
const scope = self as unknown as {
  postMessage(msg: WorkerResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

let current: Heightmap | null = null;
const aborts = new Map<number, AbortController>();

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  switch (req.type) {
    case 'cancel':
      aborts.get(req.id)?.abort();
      aborts.delete(req.id);
      return;

    case 'prepare': {
      const abort = new AbortController();
      aborts.set(req.id, abort);
      try {
        const set = await prepareSet(req.params, (done, total) => post({ type: 'progress', id: req.id, done, total }), abort.signal);
        if (abort.signal.aborted) return;
        current = set.hm;
        // 標高データは Worker 側にも残すので、本体へはコピーを送る
        const hm: Heightmap = { ...set.hm, data: set.hm.data.slice() };
        post({ type: 'prepared', id: req.id, set: { ...set, hm } }, [
          hm.data.buffer,
          set.mesh.positions.buffer,
          set.mesh.normals.buffer,
          set.mesh.index.buffer,
          ...contourTransferables(set.contours),
        ]);
      } catch (err) {
        if (abort.signal.aborted) return;
        post({ type: 'error', id: req.id, message: (err as Error).message });
      } finally {
        aborts.delete(req.id);
      }
      return;
    }

    case 'contours': {
      if (!current) {
        post({ type: 'error', id: req.id, message: '標高データがまだ読み込まれていません' });
        return;
      }
      const contours = computeContours(current, req.interval);
      post({ type: 'contours', id: req.id, contours }, contourTransferables(contours));
      return;
    }
  }
};
