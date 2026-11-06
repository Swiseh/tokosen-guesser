import './style.css';
import { ContourMap, type MapLine, type Marker } from './contourMap';
import { QuizSession } from './game';
import { findLevel, LEVELS, type Level } from './levels';
import type { PreparedSet } from './prepare';
import { newSeed } from './random';
import { REGIONS } from './regions';
import { formatSetCode, parseSetCode, type SetSpec } from './setCode';
import { sampleMeshHeight } from './terrain';
import { TerrainService } from './terrainService';
import { Viewer3D } from './viewer3d';

/**
 * 画面とゲーム進行の橋渡し。重い処理は TerrainService（Worker）、
 * 出題の進行は QuizSession に任せ、ここでは表示と入力だけを扱う。
 */

const MAP_SIZE_M = 4000;
const MARGIN_M = 3000;
const QUESTIONS = 5;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  menuBtn: $<HTMLButtonElement>('menu-btn'),
  menu: $('menu'),
  region: $<HTMLSelectElement>('region'),
  setCode: $<HTMLInputElement>('setcode'),
  place: $('place'),
  loading: $('loading'),
  hudCompass: $('hud-compass'),
  hudAltimeter: $('hud-altimeter'),
  sbTitle: $('sb-title'),
  sbRounds: $('sb-rounds'),
  sbTotalWrap: $('sb-total-wrap'),
  sbTotal: $('sb-total'),
  widget: $('map-widget'),
  mapStatus: $('map-status'),
  mapPin: $<HTMLButtonElement>('map-pin'),
  guessBtn: $<HTMLButtonElement>('guess-btn'),
  result: $('result'),
  resultTitle: $('result-title'),
  resultMsg: $('result-msg'),
  resultBar: $('result-bar').firstElementChild as HTMLElement,
  resultPlace: $('result-place'),
  quizNext: $<HTMLButtonElement>('quiz-next'),
  quizRetry: $<HTMLButtonElement>('quiz-retry'),
  quizNewSet: $<HTMLButtonElement>('quiz-newset'),
  compass: $<HTMLInputElement>('compass'),
  levelName: $('level-name'),
  start: $('start'),
  levels: $('levels'),
  startStatus: $('start-status'),
  interval: $<HTMLSelectElement>('interval'),
  eyeWrap: $('eye-wrap'),
};

for (const r of REGIONS) ui.region.add(new Option(r.name, r.id));

const service = new TerrainService();
const map = new ContourMap($('map'));
const viewer = new Viewer3D($('view'));

type Mode = 'free' | 'quiz';
let mode: Mode = 'quiz';
let set: PreparedSet | null = null;
let session: QuizSession | null = null;
let level: Level = findLevel(loadPref('level')) ?? LEVELS[0];

// ---------- セットの読み込み ----------

async function loadSet(spec: SetSpec) {
  const code = formatSetCode(spec);
  ui.region.value = spec.regionId;
  ui.setCode.value = code;
  ui.setCode.classList.remove('invalid');
  history.replaceState(null, '', `#${code}`);
  // レベル選択画面が開いている間は、その下で読み込みを進めて進み具合だけ表示する
  const setProgress = (text: string) => {
    ui.loading.textContent = text;
    ui.startStatus.textContent = text;
  };
  ui.loading.hidden = !ui.start.hidden;
  setProgress('標高データを読み込み中…');
  try {
    const s = await service.prepare(
      { spec, mapSizeMeters: MAP_SIZE_M, marginMeters: MARGIN_M, questions: QUESTIONS, interval: currentInterval() },
      (d, n) => setProgress(d < n ? `標高データを読み込み中… ${d} / ${n} タイル` : '地形を計算中…'),
    );
    set = s;
    map.setTerrain(s.hm, s.contours);
    viewer.setTerrain(s.hm, s.mesh);
    // 読み込み中に等高線の間隔が変えられていたら計算し直す
    if (s.contours.interval !== currentInterval()) refreshContours();
    if (mode === 'quiz') startQuiz();
    else enterFree();
    ui.loading.hidden = true;
    ui.startStatus.textContent = `準備できました（${s.hm.label}）`;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    console.error(e);
    setProgress(`読み込みに失敗しました：${(e as Error).message}`);
  }
}

function newSet(regionId = ui.region.value) {
  closeMenu();
  loadSet({ regionId, seed: newSeed() });
}

function currentInterval() {
  return Number(ui.interval.value);
}

async function refreshContours() {
  const target = set;
  const interval = currentInterval();
  if (!target) return;
  const c = await service.contours(interval);
  if (set === target && interval === currentInterval()) map.setContours(c);
}

function placeHtml(separator = '<br>') {
  const c = set?.hm.center;
  if (!set || !c) return '';
  return `${set.hm.label}　${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}${separator}<a href="https://maps.gsi.go.jp/#14/${c.lat.toFixed(5)}/${c.lon.toFixed(5)}/" target="_blank" rel="noopener">地理院地図で見る</a>`;
}

/** 場所の情報は、答えが分かってしまうので出題中は出さない */
function updatePlace() {
  const show = mode === 'free' || session?.phase === 'finished';
  ui.place.innerHTML = show ? placeHtml() : '';
  ui.resultPlace.innerHTML = session?.phase === 'finished' ? placeHtml('　') : '';
}

// ---------- 自由モード ----------

function enterFree() {
  mode = 'free';
  session = null;
  ui.eyeWrap.hidden = false;
  setResultMode(false);
  ui.result.hidden = true;
  if (set) {
    const q = set.questions[0];
    viewer.setViewpoint(q.col, q.row, q.yaw);
  }
  refreshAll();
}

// ---------- 出題モード ----------

function startQuiz() {
  mode = 'quiz';
  ui.eyeWrap.hidden = true;
  viewer.setSettings({ eyeHeight: 1.7 });
  (document.getElementById('eye') as HTMLInputElement).value = '0';
  $('eye-val').textContent = '1.7 m';
  if (!set) return;
  session = new QuizSession(set.questions, set.hm.metersPerPixel, MAP_SIZE_M);
  showQuestion();
}

function showQuestion() {
  if (!session) return;
  const q = session.current;
  viewer.setViewpoint(q.col, q.row, q.yaw);
  viewer.resetZoom();
  ui.result.hidden = true;
  setResultMode(false);
  map.resetView();
  refreshAll();
}

function submitGuess() {
  if (!session || !set) return;
  const a = session.submit();
  if (!a) return;
  const q = session.current;
  const elev = Math.round(sampleMeshHeight(set.hm, q.col, q.row));
  ui.resultTitle.textContent = `${a.score.toLocaleString()} 点`;
  ui.resultMsg.textContent = `誤差 ${formatDist(a.distance)}　・　正解地点の標高 ${elev} m`;
  ui.resultBar.style.width = `${(a.score / 5000) * 100}%`;
  showResultButtons({ next: true });
  ui.quizNext.textContent = session.isLast ? '結果を見る' : '次の問題へ';
  ui.result.hidden = false;
  setResultMode(true);
  map.fitTo([a.guess, q]);
  refreshAll();
}

function nextQuestion() {
  if (!session) return;
  session.next();
  if (session.phase === 'guessing') {
    showQuestion();
    return;
  }
  ui.resultTitle.textContent = `合計 ${session.totalScore.toLocaleString()} / ${session.maxScore.toLocaleString()} 点`;
  // 各問の点数は右上のスコアボードに出ているので、ここは要約だけ
  const avg = session.answers.reduce((s, a) => s + a.distance, 0) / session.answers.length;
  const best = Math.max(...session.answers.map((a) => a.score));
  ui.resultMsg.textContent = `平均誤差 ${formatDist(avg)}　・　最高 ${best} 点`;
  ui.resultBar.style.width = `${(session.totalScore / session.maxScore) * 100}%`;
  showResultButtons({ retry: true, newSet: true });
  map.fitTo(session.questions.flatMap((q, i) => [q, session!.answers[i].guess]));
  refreshAll();
}

function showResultButtons(show: { next?: boolean; retry?: boolean; newSet?: boolean }) {
  ui.quizNext.hidden = !show.next;
  ui.quizRetry.hidden = !show.retry;
  ui.quizNewSet.hidden = !show.newSet;
}

function formatDist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

// ---------- 表示の更新 ----------

function refreshAll() {
  applyControls();
  updateOverlay();
  updateScoreboard();
  updateGuessButton();
  updatePlace();
  $('mode-free').classList.toggle('active', mode === 'free');
  $('mode-quiz').classList.toggle('active', mode === 'quiz');
  ui.levelName.textContent = level.name;
}

/** 3Dビューの操作制限。レベルの制限がかかるのは出題中（回答前）だけ */
function applyControls() {
  const restricted = mode === 'quiz' && session?.phase === 'guessing';
  viewer.setControls(restricted ? { pan: level.canPan, zoom: level.canZoom } : { pan: true, zoom: true });
}

function updateOverlay() {
  const markers: Marker[] = [];
  const lines: MapLine[] = [];
  const view = { ...viewer.position, yaw: viewer.yaw, hfov: viewer.hfov };

  if (mode === 'free') {
    markers.push({ ...view, kind: 'viewpoint' });
  } else if (session) {
    const s = session;
    s.questions.forEach((q, i) => {
      const current = i === s.index;
      if (current && s.phase === 'guessing') {
        if (s.guess) markers.push({ ...s.guess, kind: 'guess' });
        return;
      }
      const a = s.answers[i];
      if (!a) return; // まだ出題していない問題
      const faded = !current && s.phase !== 'finished';
      lines.push({ from: a.guess, to: q });
      markers.push({ ...a.guess, kind: faded ? 'past-guess' : 'guess' });
      markers.push({
        col: q.col,
        row: q.row,
        kind: faded ? 'past-answer' : 'answer',
        label: String(i + 1),
        ...(current ? { yaw: view.yaw, hfov: view.hfov } : {}),
      });
    });
  }
  map.setOverlay(markers, lines);
  updateHud(view);
}

function updateHud(view: { col: number; row: number; yaw: number }) {
  // 回答前の出題中だけ、設定に応じてコンパス・標高計を隠す
  const hideable = mode === 'quiz' && session?.phase === 'guessing';

  const showCompass = !hideable || ui.compass.checked;
  ui.hudCompass.hidden = !showCompass;
  if (showCompass) {
    const deg = Math.round((view.yaw * 180) / Math.PI) % 360;
    const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
    ui.hudCompass.textContent = `${dirs[Math.round(deg / 45) % 8]}　${String(deg).padStart(3, '0')}°`;
  }

  const showAltimeter = !!set && (!hideable || level.altimeter);
  ui.hudAltimeter.hidden = !showAltimeter;
  if (showAltimeter) {
    // 足元の地面の標高（目線の高さは含めない）
    ui.hudAltimeter.textContent = `標高 ${Math.round(sampleMeshHeight(set!.hm, view.col, view.row))} m`;
  }
}

function updateScoreboard() {
  ui.sbTitle.textContent = set ? `${set.hm.label}　·　${mode === 'free' ? '探索' : level.name}` : '';
  const quiz = mode === 'quiz' && session;
  ui.sbRounds.hidden = ui.sbTotalWrap.hidden = !quiz;
  if (!quiz) return;
  const s = session!;
  ui.sbRounds.replaceChildren(
    ...s.questions.map((_, i) => {
      const cell = document.createElement('div');
      cell.className = 'sb-round';
      if (i === s.index && s.phase !== 'finished') cell.classList.add('current');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(i + 1);
      const sc = document.createElement('span');
      sc.className = 's';
      sc.textContent = s.answers[i] ? String(s.answers[i].score) : '';
      cell.append(n, sc);
      return cell;
    }),
  );
  ui.sbTotal.textContent = s.totalScore.toLocaleString();
}

function updateGuessButton() {
  const guessing = mode === 'quiz' && session?.phase === 'guessing';
  ui.guessBtn.hidden = !guessing;
  if (!guessing) return;
  ui.guessBtn.disabled = !session!.guess;
  ui.guessBtn.textContent = session!.guess ? 'この地点で決定（Space）' : '地図をクリックして地点を選ぶ';
}

// ---------- 地図ウィンドウ ----------

/** 地図ウィンドウの見た目の設定（閲覧者ごとの好みとして保存） */
const widgetPrefs = loadWidgetPrefs();
let widgetHover = false;
let widgetLeaveTimer = 0;

function loadWidgetPrefs(): { size: number; pinned: boolean; side: 'left' | 'right' } {
  const fallback = { size: 1, pinned: false, side: 'left' as const };
  const raw = loadPref('mapWidget');
  try {
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function saveWidgetPrefs() {
  savePref('mapWidget', JSON.stringify(widgetPrefs));
}

function applyWidget() {
  const w = ui.widget;
  w.classList.remove('size-1', 'size-2', 'size-3', 'side-left', 'side-right');
  w.classList.add(`size-${widgetPrefs.size}`, `side-${widgetPrefs.side}`);
  w.classList.toggle('open', widgetHover || widgetPrefs.pinned);
  ui.mapPin.classList.toggle('active', widgetPrefs.pinned);
}

function setResultMode(on: boolean) {
  ui.widget.classList.toggle('result', on);
}

ui.widget.addEventListener('mouseenter', () => {
  clearTimeout(widgetLeaveTimer);
  widgetHover = true;
  applyWidget();
});
ui.widget.addEventListener('mouseleave', () => {
  clearTimeout(widgetLeaveTimer);
  widgetLeaveTimer = window.setTimeout(function close() {
    // 地図をドラッグしたまま外に出た場合は、離すまで閉じない
    if (map.isDragging) {
      widgetLeaveTimer = window.setTimeout(close, 200);
      return;
    }
    widgetHover = false;
    applyWidget();
  }, 400);
});
$('map-grow').addEventListener('click', () => {
  widgetPrefs.size = Math.min(3, widgetPrefs.size + 1);
  saveWidgetPrefs();
  applyWidget();
});
$('map-shrink').addEventListener('click', () => {
  widgetPrefs.size = Math.max(1, widgetPrefs.size - 1);
  saveWidgetPrefs();
  applyWidget();
});
ui.mapPin.addEventListener('click', () => {
  widgetPrefs.pinned = !widgetPrefs.pinned;
  saveWidgetPrefs();
  applyWidget();
});
$('map-side').addEventListener('click', () => {
  widgetPrefs.side = widgetPrefs.side === 'left' ? 'right' : 'left';
  saveWidgetPrefs();
  applyWidget();
});
$('zoom-in').addEventListener('click', () => map.zoomBy(1.6));
$('zoom-out').addEventListener('click', () => map.zoomBy(1 / 1.6));
$('zoom-reset').addEventListener('click', () => map.resetView());

// ---------- メニュー ----------

function openMenu() {
  ui.menu.hidden = false;
  ui.menuBtn.setAttribute('aria-expanded', 'true');
}
function closeMenu() {
  ui.menu.hidden = true;
  ui.menuBtn.setAttribute('aria-expanded', 'false');
}
ui.menuBtn.addEventListener('click', () => (ui.menu.hidden ? openMenu() : closeMenu()));
document.addEventListener('pointerdown', (e) => {
  const t = e.target as Node;
  if (!ui.menu.hidden && !ui.menu.contains(t) && !ui.menuBtn.contains(t)) closeMenu();
});

// ---------- イベント ----------

viewer.onViewChange = updateOverlay;

map.onClick = (col, row) => {
  if (mode === 'free') {
    viewer.setViewpoint(col, row);
  } else if (session?.setGuess(col, row)) {
    updateOverlay();
    updateGuessButton();
  }
};

map.onHover = (_c, _r, elev) => {
  ui.mapStatus.textContent = mode === 'free' ? `標高 ${Math.round(elev)} m` : '';
};

function loadFromCode(code: string) {
  const spec = parseSetCode(code);
  if (!spec) {
    ui.setCode.classList.add('invalid');
    return false;
  }
  closeMenu();
  loadSet(spec);
  return true;
}

$('new-map').addEventListener('click', () => newSet());
ui.region.addEventListener('change', () => newSet());
$('load-code').addEventListener('click', () => loadFromCode(ui.setCode.value));
ui.setCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadFromCode(ui.setCode.value);
});
ui.setCode.addEventListener('input', () => ui.setCode.classList.remove('invalid'));
$('copy-code').addEventListener('click', () => {
  navigator.clipboard?.writeText(ui.setCode.value).catch(() => ui.setCode.select());
});
window.addEventListener('hashchange', () => {
  const code = decodeURIComponent(location.hash.slice(1));
  if (set && code === formatSetCode(set.spec)) return;
  loadFromCode(code);
});

$('mode-free').addEventListener('click', () => {
  enterFree();
  closeMenu();
});
$('mode-quiz').addEventListener('click', () => {
  startQuiz();
  closeMenu();
});
ui.guessBtn.addEventListener('click', submitGuess);
ui.quizNext.addEventListener('click', nextQuestion);
ui.quizRetry.addEventListener('click', startQuiz);
ui.quizNewSet.addEventListener('click', () => newSet());
ui.compass.addEventListener('change', updateOverlay);

ui.interval.addEventListener('change', refreshContours);
$<HTMLInputElement>('labels').addEventListener('change', (e) => map.setLabels((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('visibility').addEventListener('input', (e) => {
  const km = Number((e.target as HTMLInputElement).value);
  $('visibility-val').textContent = `${km} km`;
  viewer.setSettings({ visibility: km * 1000 });
});
$<HTMLInputElement>('eye').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  const h = v === 0 ? 1.7 : v;
  $('eye-val').textContent = `${h} m`;
  viewer.setSettings({ eyeHeight: h });
});

// キーボード：Space / Enter で決定・次へ、Esc でメニューを閉じる
window.addEventListener('keydown', (e) => {
  if (!ui.start.hidden) {
    // レベル選択画面：1〜3 キーで選ぶ。ゲーム中にメニューから開いた場合は Esc で戻る
    if (e.key === 'Escape' && session) {
      ui.start.hidden = true;
      return;
    }
    const l = LEVELS[Number(e.key) - 1];
    if (l) chooseLevel(l);
    return;
  }
  if (e.key === 'Escape') {
    closeMenu();
    return;
  }
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key !== ' ' && e.key !== 'Enter') return;
  if (!session || mode !== 'quiz') return;
  if (session.phase === 'guessing' && session.guess) {
    e.preventDefault();
    submitGuess();
  } else if (session.phase === 'revealed') {
    e.preventDefault();
    nextQuestion();
  }
});

// ---------- レベル選択 ----------

function renderLevels() {
  ui.levels.replaceChildren(
    ...LEVELS.map((l, i) => {
      const b = document.createElement('button');
      b.className = 'level';
      if (l.id === level.id) b.classList.add('last');
      const tag = (text: string, on: boolean) => `<span class="level-tag${on ? '' : ' off'}">${text}</span>`;
      b.innerHTML = `
        <span class="level-head"><span class="level-name">${l.name}</span><span class="level-key">${i + 1}</span></span>
        <span class="level-desc">${l.description}</span>
        <span class="level-tags">${tag('見回し', l.canPan)}${tag('ズーム', l.canZoom)}${tag('標高計', l.altimeter)}</span>`;
      b.addEventListener('click', () => chooseLevel(l));
      return b;
    }),
  );
}

function openStart() {
  closeMenu();
  renderLevels();
  ui.start.hidden = false;
}

/** レベルを決めて出題を始める（地形の読み込み中なら、終わり次第始まる） */
function chooseLevel(l: Level) {
  level = l;
  savePref('level', l.id);
  ui.start.hidden = true;
  if (!set) {
    ui.loading.hidden = false;
    return;
  }
  startQuiz();
}

$('change-level').addEventListener('click', openStart);

// ---------- 閲覧者ごとの設定の保存（保存できない環境では何もしない） ----------

function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // プライベートモードなど
  }
}

applyWidget();
renderLevels();
// URL の # にセットコードがあればそれを、なければ新しいセットを読み込む
if (!loadFromCode(decodeURIComponent(location.hash.slice(1)))) newSet(REGIONS[0].id);
