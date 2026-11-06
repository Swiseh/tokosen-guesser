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

const COLOR_BG = '#fbf8ef';
const COLOR_CONTOUR = '#b0703a';

/**
 * 等高線図の描画。等高線の計算は contours.ts（Worker）で行い、ここでは描くだけ。
 * 等高線はオフスクリーンに一度だけ描き、マーカー類は毎回その上に重ねる。
 */
export class ContourMap {
  readonly canvas: HTMLCanvasElement;
  private base = document.createElement('canvas');
  private hm: Heightmap | null = null;
  private contours: ContourData | null = null;
  private labels = true;
  private markers: Marker[] = [];
  private lines: MapLine[] = [];
  private cssSize = 0;
  private dpr = 1;

  onClick?: (col: number, row: number) => void;
  onHover?: (col: number, row: number, elevation: number) => void;

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    container.appendChild(this.canvas);
    new ResizeObserver(() => this.resize()).observe(container);
    this.canvas.addEventListener('click', (e) => {
      const p = this.eventToGrid(e);
      if (p) this.onClick?.(p.col, p.row);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      const p = this.eventToGrid(e);
      if (p && this.hm) this.onHover?.(p.col, p.row, heightAt(this.hm, Math.round(p.col), Math.round(p.row)));
    });
  }

  setTerrain(hm: Heightmap, contours: ContourData) {
    this.hm = hm;
    this.contours = contours;
    this.renderBase();
    this.draw();
  }

  setContours(contours: ContourData) {
    this.contours = contours;
    this.renderBase();
    this.draw();
  }

  setLabels(on: boolean) {
    this.labels = on;
    this.renderBase();
    this.draw();
  }

  setOverlay(markers: Marker[], lines: MapLine[] = []) {
    this.markers = markers;
    this.lines = lines;
    this.draw();
  }

  private resize() {
    const r = this.container.getBoundingClientRect();
    const size = Math.floor(Math.min(r.width, r.height));
    if (size <= 0 || size === this.cssSize) return;
    this.cssSize = size;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.canvas.width = this.canvas.height = Math.round(size * this.dpr);
    this.renderBase();
    this.draw();
  }

  /** グリッド座標 → キャンバスのCSSピクセル */
  private toScreen(col: number, row: number) {
    const { col0, row0, size } = this.hm!.mapRect;
    const s = this.cssSize / size;
    return { x: (col - col0) * s, y: (row - row0) * s };
  }

  private eventToGrid(e: MouseEvent) {
    if (!this.hm) return null;
    const rect = this.canvas.getBoundingClientRect();
    const { col0, row0, size } = this.hm.mapRect;
    const s = size / this.cssSize;
    return { col: col0 + (e.clientX - rect.left) * s, row: row0 + (e.clientY - rect.top) * s };
  }

  /** 等高線をオフスクリーンキャンバスに描く（地形・等高線・設定が変わったときだけ） */
  private renderBase() {
    const data = this.contours;
    if (!data || this.cssSize === 0) return;
    const W = this.canvas.width;
    this.base.width = this.base.height = W;
    const ctx = this.base.getContext('2d')!;
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, W, W);

    const scale = W / data.size;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, W);
    ctx.clip();
    ctx.strokeStyle = COLOR_CONTOUR;
    ctx.lineJoin = 'round';
    const labelCandidates: { x: number; y: number; angle: number; value: number }[] = [];
    for (const level of data.levels) {
      const { coords, ringStarts, isIndex } = level;
      ctx.lineWidth = (isIndex ? 1.6 : 0.7) * this.dpr;
      ctx.beginPath();
      for (let r = 0; r < ringStarts.length - 1; r++) {
        const s = ringStarts[r];
        const e = ringStarts[r + 1];
        for (let i = s; i < e; i++) {
          const x = coords[i * 2] * scale;
          const y = coords[i * 2 + 1] * scale;
          if (i === s) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        if (isIndex && this.labels && e - s > 60) {
          const m = s + Math.floor((e - s) / 2);
          labelCandidates.push({
            x: coords[m * 2] * scale,
            y: coords[m * 2 + 1] * scale,
            angle: Math.atan2(coords[(m + 2) * 2 + 1] - coords[(m - 2) * 2 + 1], coords[(m + 2) * 2] - coords[(m - 2) * 2]),
            value: level.value,
          });
        }
      }
      ctx.stroke();
    }

    // 計曲線の標高ラベル（近すぎるものは間引く）
    if (this.labels) {
      const placed: { x: number; y: number }[] = [];
      const minDist = 90 * this.dpr;
      const margin = 20 * this.dpr;
      ctx.font = `${11 * this.dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of labelCandidates) {
        if (l.x < margin || l.y < margin || l.x > W - margin || l.y > W - margin) continue;
        if (placed.some((q) => Math.hypot(q.x - l.x, q.y - l.y) < minDist)) continue;
        placed.push(l);
        let ang = l.angle;
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate(ang);
        const text = String(Math.round(l.value));
        const w = ctx.measureText(text).width + 4 * this.dpr;
        ctx.fillStyle = COLOR_BG;
        ctx.fillRect(-w / 2, -7 * this.dpr, w, 14 * this.dpr);
        ctx.fillStyle = COLOR_CONTOUR;
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  draw() {
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    if (!this.hm || !this.contours) return;
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawScaleAndNorth(ctx);

    for (const l of this.lines) {
      const a = this.toScreen(l.from.col, l.from.row);
      const b = this.toScreen(l.to.col, l.to.row);
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

  private drawMarker(ctx: CanvasRenderingContext2D, m: Marker) {
    const p = this.toScreen(m.col, m.row);
    const color = {
      viewpoint: '#d62828',
      answer: '#d62828',
      'past-answer': '#d6282899',
      guess: '#1d4ed8',
      'past-guess': '#1d4ed899',
    }[m.kind];

    if (m.yaw !== undefined && m.hfov !== undefined) {
      // 視野の扇形（北=画面上、時計回り）
      const r = 70;
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
    const pxPerMeter = this.cssSize / (hm.mapRect.size * hm.metersPerPixel);
    const len = 1000 * pxPerMeter;
    const x = 12;
    const y = this.cssSize - 14;
    ctx.fillStyle = 'rgba(251, 248, 239, 0.85)';
    ctx.fillRect(x - 6, y - 18, len + 12, 26);
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
    ctx.fillText('1 km', x + len / 2, y - 4);

    // 方位記号
    const nx = this.cssSize - 22;
    const ny = 26;
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(nx, ny - 14);
    ctx.lineTo(nx + 6, ny + 4);
    ctx.lineTo(nx, ny);
    ctx.lineTo(nx - 6, ny + 4);
    ctx.closePath();
    ctx.fill();
    ctx.textBaseline = 'top';
    ctx.fillText('N', nx, ny + 6);
  }
}
