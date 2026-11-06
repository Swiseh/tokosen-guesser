import type { ContourData } from './contours';
import type { Heightmap } from './terrain';
import { heightAt } from './terrain';

export interface Marker {
  col: number;
  row: number;
  kind: 'viewpoint' | 'guess' | 'answer' | 'past-answer' | 'past-guess';
  /** 視点の向き [rad]（北=0、時計回り）と水平画角 [rad]。指定があれば視野の扇形を描く */
  yaw?: number;
  hfov?: number;
  label?: string;
}

/** 地図上の線分（回答と正解を結ぶ線など） */
export interface MapLine {
  from: { col: number; row: number };
  to: { col: number; row: number };
}

const COLOR_PAPER = '#fbf8ef';
const COLOR_OUTSIDE = '#d9d4c5';
const COLOR_CONTOUR = '#b0703a';
const MIN_ZOOM = 1;
const MAX_ZOOM = 24;
/** これ以上動いたらクリックではなくドラッグとみなす [px] */
const DRAG_THRESHOLD = 4;

/** 等高線を Path2D にまとめたもの（地図範囲の左上が原点のグリッド座標） */
interface ContourPaths {
  minor: Path2D;
  index: Path2D;
  labels: { u: number; v: number; angle: number; value: number }[];
}

/**
 * 等高線図。拡大・縮小（ホイール・ボタン）とドラッグでのスクロールに対応。
 * 等高線の計算は contours.ts（Worker）で行い、ここでは描くだけ。
 *
 * 座標：地図座標 (u, v) = (col - col0, row - row0)。表示は「中心 (cu, cv)」と「倍率 zoom」で決まる。
 * zoom=1 で地図全体がちょうど収まる。
 */
export class ContourMap {
  readonly canvas: HTMLCanvasElement;
  private hm: Heightmap | null = null;
  private paths: ContourPaths | null = null;
  private labels = true;
  private markers: Marker[] = [];
  private lines: MapLine[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cu = 0;
  private cv = 0;
  private zoom = 1;
  private dirty = false;

  onClick?: (col: number, row: number) => void;
  onHover?: (col: number, row: number, elevation: number) => void;

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    container.appendChild(this.canvas);
    new ResizeObserver(() => this.resize()).observe(container);
    this.setupInput();
  }

  // ---------- 公開 API ----------

  setTerrain(hm: Heightmap, contours: ContourData) {
    this.hm = hm;
    this.paths = buildPaths(contours);
    this.resetView();
  }

  setContours(contours: ContourData) {
    this.paths = buildPaths(contours);
    this.requestRender();
  }

  setLabels(on: boolean) {
    this.labels = on;
    this.requestRender();
  }

  setOverlay(markers: Marker[], lines: MapLine[] = []) {
    this.markers = markers;
    this.lines = lines;
    this.requestRender();
  }

  /** 地図全体が収まる表示に戻す */
  resetView() {
    if (!this.hm) return;
    this.fitTarget = null;
    this.zoom = 1;
    this.cu = this.cv = this.hm.mapRect.size / 2;
    this.requestRender();
  }

  /** 画面中央を基準に拡大・縮小 */
  zoomBy(factor: number) {
    this.zoomAt(this.w / 2, this.h / 2, factor);
  }

  /**
   * 指定した地点がすべて収まるように表示する（答え合わせ用）。
   * 地図ウィンドウの大きさが変わっている途中でも、利用者が操作するまでは大きさの変化に追従する。
   */
  fitTo(points: { col: number; row: number }[]) {
    this.fitTarget = points;
    this.applyFit();
  }

  private fitTarget: { col: number; row: number }[] | null = null;

  private applyFit(paddingPx = 60) {
    const points = this.fitTarget;
    if (!this.hm || !points || points.length === 0 || this.w === 0) return;
    const { col0, row0 } = this.hm.mapRect;
    const us = points.map((p) => p.col - col0);
    const vs = points.map((p) => p.row - row0);
    const minU = Math.min(...us);
    const maxU = Math.max(...us);
    const minV = Math.min(...vs);
    const maxV = Math.max(...vs);
    this.cu = (minU + maxU) / 2;
    this.cv = (minV + maxV) / 2;
    const k0 = this.baseScale();
    const spanU = Math.max(maxU - minU, 1);
    const spanV = Math.max(maxV - minV, 1);
    const k = Math.min((this.w - 2 * paddingPx) / spanU, (this.h - 2 * paddingPx) / spanV);
    if (!(k > 0)) return;
    this.zoom = clamp(k / k0, MIN_ZOOM, 6);
    this.clampCenter();
    this.requestRender();
  }

  // ---------- 座標変換 ----------

  /** zoom=1 のときの 1 グリッドあたりの画面 px */
  private baseScale() {
    return this.hm ? Math.min(this.w, this.h) / this.hm.mapRect.size : 1;
  }

  private get scale() {
    return this.baseScale() * this.zoom;
  }

  private mapToScreen(u: number, v: number) {
    const k = this.scale;
    return { x: (u - this.cu) * k + this.w / 2, y: (v - this.cv) * k + this.h / 2 };
  }

  private screenToMap(x: number, y: number) {
    const k = this.scale;
    return { u: (x - this.w / 2) / k + this.cu, v: (y - this.h / 2) / k + this.cv };
  }

  private gridToScreen(col: number, row: number) {
    return this.mapToScreen(col - this.hm!.mapRect.col0, row - this.hm!.mapRect.row0);
  }

  private zoomAt(x: number, y: number, factor: number) {
    if (!this.hm) return;
    this.fitTarget = null;
    const before = this.screenToMap(x, y);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = this.scale;
    // カーソル下の地点が動かないように中心をずらす
    this.cu = before.u - (x - this.w / 2) / k;
    this.cv = before.v - (y - this.h / 2) / k;
    this.clampCenter();
    this.requestRender();
  }

  /** 地図の外へ行き過ぎないよう、中心を地図範囲内に制限する */
  private clampCenter() {
    if (!this.hm) return;
    const s = this.hm.mapRect.size;
    this.cu = clamp(this.cu, 0, s);
    this.cv = clamp(this.cv, 0, s);
  }

  // ---------- 入力 ----------

  private setupInput() {
    const el = this.canvas;
    let down: { x: number; y: number; cu: number; cv: number; id: number } | null = null;
    let dragged = false;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, cu: this.cu, cv: this.cv, id: e.pointerId };
      dragged = false;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.localPoint(e);
      if (down && e.pointerId === down.id) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          dragged = true;
          el.classList.add('dragging');
        }
        if (dragged) {
          this.fitTarget = null;
          const k = this.scale;
          this.cu = down.cu - dx / k;
          this.cv = down.cv - dy / k;
          this.clampCenter();
          this.requestRender();
        }
      }
      if (this.hm && !dragged) {
        const m = this.screenToMap(p.x, p.y);
        const col = m.u + this.hm.mapRect.col0;
        const row = m.v + this.hm.mapRect.row0;
        this.onHover?.(col, row, heightAt(this.hm, Math.round(col), Math.round(row)));
      }
    });
    const end = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('dragging');
      if (!dragged && e.type === 'pointerup' && this.hm) {
        const p = this.localPoint(e);
        const m = this.screenToMap(p.x, p.y);
        const s = this.hm.mapRect.size;
        // 地図範囲の外はクリックとして扱わない
        if (m.u >= 0 && m.v >= 0 && m.u <= s && m.v <= s) this.onClick?.(m.u + this.hm.mapRect.col0, m.v + this.hm.mapRect.row0);
      }
      down = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this.localPoint(e);
        this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  private localPoint(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- 描画 ----------

  private resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.floor(r.width);
    const h = Math.floor(r.height);
    if (w <= 0 || h <= 0 || (w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (this.fitTarget) this.applyFit();
    this.render();
  }

  /** ドラッグ中か（地図ウィンドウを閉じるかの判定に使う） */
  get isDragging() {
    return this.canvas.classList.contains('dragging');
  }

  private requestRender() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => {
      this.dirty = false;
      this.render();
    });
  }

  private render() {
    const ctx = this.canvas.getContext('2d')!;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOR_OUTSIDE;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.hm || !this.paths) return;

    const s = this.hm.mapRect.size;
    const k = this.scale;
    const o = this.mapToScreen(0, 0);

    // 地図範囲（紙）と等高線。等高線は地図座標のまま変換行列で拡大し、線幅だけ画面 px で一定にする
    ctx.save();
    ctx.beginPath();
    ctx.rect(o.x, o.y, s * k, s * k);
    ctx.fillStyle = COLOR_PAPER;
    ctx.fill();
    ctx.clip();
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * o.x, dpr * o.y);
    ctx.strokeStyle = COLOR_CONTOUR;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.7 / k;
    ctx.stroke(this.paths.minor);
    ctx.lineWidth = 1.6 / k;
    ctx.stroke(this.paths.index);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.labels) this.drawLabels(ctx);
    ctx.restore();

    this.drawScaleAndNorth(ctx);
    for (const l of this.lines) {
      const a = this.gridToScreen(l.from.col, l.from.row);
      const b = this.gridToScreen(l.to.col, l.to.row);
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const m of this.markers) this.drawMarker(ctx, m);
  }

  /** 計曲線の標高ラベル。画面上で近すぎるものは間引く */
  private drawLabels(ctx: CanvasRenderingContext2D) {
    const placed: { x: number; y: number }[] = [];
    const minDist = 90;
    const margin = 16;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of this.paths!.labels) {
      const p = this.mapToScreen(l.u, l.v);
      if (p.x < margin || p.y < margin || p.x > this.w - margin || p.y > this.h - margin) continue;
      if (placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < minDist)) continue;
      placed.push(p);
      let ang = l.angle;
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      const text = String(Math.round(l.value));
      const w = ctx.measureText(text).width + 4;
      ctx.fillStyle = COLOR_PAPER;
      ctx.fillRect(-w / 2, -7, w, 14);
      ctx.fillStyle = COLOR_CONTOUR;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  private drawMarker(ctx: CanvasRenderingContext2D, m: Marker) {
    const p = this.gridToScreen(m.col, m.row);
    const color = {
      viewpoint: '#d62828',
      answer: '#d62828',
      'past-answer': '#d6282899',
      guess: '#1d4ed8',
      'past-guess': '#1d4ed899',
    }[m.kind];

    if (m.yaw !== undefined && m.hfov !== undefined) {
      // 視野の扇形（北=画面上、時計回り）
      const r = 60;
      const a0 = m.yaw - m.hfov / 2 - Math.PI / 2;
      const a1 = m.yaw + m.hfov / 2 - Math.PI / 2;
      ctx.fillStyle = 'rgba(214, 40, 40, 0.15)';
      ctx.strokeStyle = 'rgba(214, 40, 40, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, r, a0, a1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    const radius = m.kind.startsWith('past') ? 4 : 6;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (m.label) {
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(m.label, p.x + 8, p.y);
      ctx.fillStyle = color;
      ctx.fillText(m.label, p.x + 8, p.y);
    }
  }

  private drawScaleAndNorth(ctx: CanvasRenderingContext2D) {
    const hm = this.hm!;
    const pxPerMeter = this.scale / hm.metersPerPixel;
    // 画面上で 60〜150px 程度になるきりの良い長さを選ぶ
    const meters = [50, 100, 200, 500, 1000, 2000].find((m) => m * pxPerMeter >= 60) ?? 2000;
    const len = meters * pxPerMeter;
    const x = 10;
    const y = this.h - 10;
    ctx.fillStyle = 'rgba(251, 248, 239, 0.85)';
    ctx.fillRect(x - 5, y - 18, len + 10, 24);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.lineTo(x + len, y - 5);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, x + len / 2, y - 4);

    // 方位記号（右上）
    const nx = this.w - 18;
    const ny = 22;
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(nx, ny - 12);
    ctx.lineTo(nx + 5, ny + 4);
    ctx.lineTo(nx, ny);
    ctx.lineTo(nx - 5, ny + 4);
    ctx.closePath();
    ctx.fill();
    ctx.textBaseline = 'top';
    ctx.fillText('N', nx, ny + 5);
  }
}

/** 等高線データを Path2D にまとめる（地形・間隔が変わったときだけ） */
function buildPaths(data: ContourData): ContourPaths {
  const minor = new Path2D();
  const index = new Path2D();
  const labels: ContourPaths['labels'] = [];
  for (const level of data.levels) {
    const { coords, ringStarts, isIndex } = level;
    const path = isIndex ? index : minor;
    for (let r = 0; r < ringStarts.length - 1; r++) {
      const s = ringStarts[r];
      const e = ringStarts[r + 1];
      path.moveTo(coords[s * 2], coords[s * 2 + 1]);
      for (let i = s + 1; i < e; i++) path.lineTo(coords[i * 2], coords[i * 2 + 1]);
      // 長い計曲線の途中にラベル候補を置く（長いものは複数）
      if (isIndex && e - s > 40) {
        for (let m = s + 20; m < e - 20; m += 120) {
          labels.push({
            u: coords[m * 2],
            v: coords[m * 2 + 1],
            angle: Math.atan2(coords[(m + 2) * 2 + 1] - coords[(m - 2) * 2 + 1], coords[(m + 2) * 2] - coords[(m - 2) * 2]),
            value: level.value,
          });
        }
      }
    }
  }
  return { minor, index, labels };
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}
