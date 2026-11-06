/**
 * 帯状のコンパス。向きに合わせて目盛りの帯が横に流れる。
 * 帯は -180°〜540° の 2 周分を一度だけ SVG で描き、向きに応じて translateX でずらす。
 */
export type CompassLabels = 'en' | 'ja';

const LABELS: Record<CompassLabels, string[]> = {
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  ja: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'],
};

/** 帯の中に見える角度の幅 [度] */
const SPAN_DEG = 90;
const FROM = -180;
const TO = 540;
const HEIGHT = 30;

export class Compass {
  readonly el: HTMLElement;
  private tape: HTMLElement;
  private width = 0;
  private yawDeg = 0;
  private labels: CompassLabels = 'en';

  onClick?: () => void;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'compass';
    this.el.setAttribute('role', 'button');
    this.el.title = '北を向く（N）';
    this.tape = document.createElement('div');
    this.tape.className = 'compass-tape';
    const marker = document.createElement('div');
    marker.className = 'compass-marker';
    this.el.append(this.tape, marker);
    container.appendChild(this.el);
    this.el.addEventListener('click', () => this.onClick?.());
    new ResizeObserver(() => {
      const w = this.el.clientWidth;
      if (w > 0 && w !== this.width) {
        this.width = w;
        this.renderTape();
      }
    }).observe(this.el);
  }

  setLabels(labels: CompassLabels) {
    this.labels = labels;
    this.renderTape();
  }

  /** 向きを設定する [rad]。北=0、時計回り */
  setYaw(yaw: number) {
    this.yawDeg = (((yaw * 180) / Math.PI) % 360 + 360) % 360;
    this.position();
  }

  /** 北を向く操作ができないとき（NMPZ の出題中など）は押せない見た目にする */
  setClickable(on: boolean) {
    this.el.classList.toggle('disabled', !on);
    this.el.title = on ? '北を向く（N）' : '';
  }

  private get pxPerDeg() {
    return this.width / SPAN_DEG;
  }

  private position() {
    if (this.width === 0) return;
    // 今の向きが帯の中央に来るようにずらす
    const x = this.width / 2 - (this.yawDeg - FROM) * this.pxPerDeg;
    this.tape.style.transform = `translateX(${x}px)`;
  }

  private renderTape() {
    if (this.width === 0) return;
    const k = this.pxPerDeg;
    const total = (TO - FROM) * k;
    const names = LABELS[this.labels];
    const parts: string[] = [];
    for (let d = FROM; d <= TO; d += 5) {
      const x = (d - FROM) * k;
      const a = ((d % 360) + 360) % 360;
      if (a % 45 === 0) {
        const i = a / 45;
        const cardinal = i % 2 === 0;
        const cls = a === 0 ? 'north' : cardinal ? 'cardinal' : 'intercardinal';
        parts.push(`<text x="${x}" y="${HEIGHT / 2}" class="${cls}">${names[i]}</text>`);
      } else {
        const len = a % 15 === 0 ? 9 : 5;
        parts.push(`<line x1="${x}" x2="${x}" y1="${HEIGHT - len - 4}" y2="${HEIGHT - 4}" />`);
      }
    }
    this.tape.innerHTML = `<svg width="${total}" height="${HEIGHT}" viewBox="0 0 ${total} ${HEIGHT}" aria-hidden="true">${parts.join('')}</svg>`;
    this.position();
  }
}
