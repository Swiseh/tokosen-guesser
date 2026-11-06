import { describe, expect, it } from 'vitest';
import { QuizSession } from '../src/game';

const questions = [
  { col: 10, row: 10, yaw: 0 },
  { col: 50, row: 50, yaw: 1 },
];

describe('QuizSession', () => {
  it('回答 → 答え合わせ → 次の問題 → 終了 の順に進む', () => {
    const s = new QuizSession(questions, 10, 4000);
    expect(s.phase).toBe('guessing');
    expect(s.submit()).toBeNull(); // 地点を選ぶ前は決定できない

    expect(s.setGuess(13, 14)).toBe(true);
    const a = s.submit()!;
    expect(a.distance).toBeCloseTo(50); // 5 セル × 10 m
    expect(s.phase).toBe('revealed');
    expect(s.setGuess(0, 0)).toBe(false); // 答え合わせ中は選び直せない

    s.next();
    expect(s.phase).toBe('guessing');
    expect(s.index).toBe(1);
    expect(s.guess).toBeNull();

    s.setGuess(50, 50);
    expect(s.submit()!.score).toBe(5000);
    expect(s.isLast).toBe(true);
    s.next();
    expect(s.phase).toBe('finished');
    expect(s.answers).toHaveLength(2);
    expect(s.totalScore).toBe(a.score + 5000);
    expect(s.maxScore).toBe(10000);
  });

  it('回答中は next() で先に進めない', () => {
    const s = new QuizSession(questions, 10, 4000);
    s.next();
    expect(s.index).toBe(0);
    expect(s.phase).toBe('guessing');
  });

  it('出題が空ならエラー', () => {
    expect(() => new QuizSession([], 10, 4000)).toThrow();
  });
});
