import { scoreForDistance } from './spots';

/** 1問分の出題（地点と最初の向き） */
export interface Question {
  col: number;
  row: number;
  /** 最初の向き [rad]。北=0、時計回り */
  yaw: number;
}

export interface Answer {
  guess: { col: number; row: number };
  /** 誤差 [m] */
  distance: number;
  score: number;
}

/**
 * guessing: 回答を選んでいる
 * revealed: 答え合わせを表示している
 * finished: 全問終わった
 */
export type Phase = 'guessing' | 'revealed' | 'finished';

/**
 * 1セット（5問）の進行。画面からは独立した純粋なロジック。
 */
export class QuizSession {
  index = 0;
  phase: Phase = 'guessing';
  /** 今の問題で選んでいる（まだ決定していない）回答 */
  guess: { col: number; row: number } | null = null;
  readonly answers: Answer[] = [];

  constructor(
    readonly questions: Question[],
    private readonly metersPerPixel: number,
    private readonly mapSizeMeters: number,
  ) {
    if (questions.length === 0) throw new Error('出題がありません');
  }

  get current(): Question {
    return this.questions[this.index];
  }

  get isLast(): boolean {
    return this.index === this.questions.length - 1;
  }

  get totalScore(): number {
    return this.answers.reduce((a, b) => a + b.score, 0);
  }

  get maxScore(): number {
    return this.questions.length * 5000;
  }

  /** 回答の地点を選ぶ（何度でも選び直せる）。回答中でなければ false */
  setGuess(col: number, row: number): boolean {
    if (this.phase !== 'guessing') return false;
    this.guess = { col, row };
    return true;
  }

  /** 選んだ地点で回答を決定する */
  submit(): Answer | null {
    if (this.phase !== 'guessing' || !this.guess) return null;
    const q = this.current;
    const distance = Math.hypot(this.guess.col - q.col, this.guess.row - q.row) * this.metersPerPixel;
    const answer = { guess: this.guess, distance, score: scoreForDistance(distance, this.mapSizeMeters) };
    this.answers.push(answer);
    this.phase = 'revealed';
    return answer;
  }

  /** 答え合わせから次の問題へ。最後の問題なら finished になる */
  next(): void {
    if (this.phase !== 'revealed') return;
    if (this.isLast) {
      this.phase = 'finished';
      return;
    }
    this.index++;
    this.guess = null;
    this.phase = 'guessing';
  }
}
