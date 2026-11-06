import './style.css';
import { ContourMap, type MapLine, type Marker } from './contourMap';
import { QuizSession } from './game';
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
  region: $<HTMLSelectElement>('region'),
  setCode: $<HTMLInputElement>('setcode'),
  status: $('status'),
  place: $('place'),
  loading: $('loading'),
  hudCompass: $('hud-compass'),
  hudAltimeter: $('hud-altimeter'),
  quiz: $('quiz'),
  quizTitle: $('quiz-title'),
  quizMsg: $('quiz-msg'),
  quizSubmit: $<HTMLButtonElement>('quiz-submit'),
  quizNext: $<HTMLButtonElement>('quiz-next'),
  quizRetry: $<HTMLButtonElement>('quiz-retry'),
  quizNewSet: $<HTMLButtonElement>('quiz-newset'),
  compass: $<HTMLInputElement>('compass'),
  altimeter: $<HTMLInputElement>('altimeter'),
  interval: $<HTMLSelectElement>('interval'),
  eyeWrap: $('eye-wrap'),
};

for (const r of REGIONS) ui.region.add(new Option(r.name, r.id));

const service = new TerrainService();
const map = new ContourMap($('map'));
const viewer = new Viewer3D($('view'));

type Mode = 'free' | 'quiz';
let mode: Mode = 'free';
let set: PreparedSet | null = null;
let session: QuizSession | null = null;

// ---------- セットの読み込み ----------

async function loadSet(spec: SetSpec) {
  const code = formatSetCode(spec);
  ui.region.value = spec.regionId;
  ui.setCode.value = code;
  ui.setCode.classList.remove('invalid');
  history.replaceState(null, '', `#${code}`);
  ui.loading.hidden = false;
  ui.loading.textContent = '標高データを読み込み中…';
  try {
    const s = await service.prepare(
      { spec, mapSizeMeters: MAP_SIZE_M, marginMeters: MARGIN_M, questions: QUESTIONS, interval: currentInterval() },
      (d, n) => (ui.loading.textContent = d < n ? `標高データを読み込み中… ${d} / ${n} タイル` : '地形を計算中…'),
    );
    set = s;
    map.setTerrain(s.hm, s.contours);
    viewer.setTerrain(s.hm, s.mesh);
    // 読み込み中に等高線の間隔が変えられていたら計算し直す
    if (s.contours.interval !== currentInterval()) refreshContours();
    if (mode === 'quiz') startQuiz();
    else enterFree();
    ui.loading.hidden = true;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    console.error(e);
    ui.loading.textContent = `読み込みに失敗しました：${(e as Error).message}`;
  }
}

function newSet(regionId = ui.region.value) {
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

function updatePlace(show: boolean) {
  const c = set?.hm.center;
  if (!set || !c || !show) {
    ui.place.textContent = '';
    return;
  }
  ui.place.innerHTML = `${set.hm.label}　${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}　<a href="https://maps.gsi.go.jp/#14/${c.lat.toFixed(5)}/${c.lon.toFixed(5)}/" target="_blank" rel="noopener">地理院地図で見る</a>`;
}

// ---------- 自由モード ----------

function enterFree() {
  mode = 'free';
  session = null;
  ui.quiz.hidden = true;
  ui.eyeWrap.hidden = false;
  setTab();
  if (!set) return;
  const q = set.questions[0];
  viewer.setViewpoint(q.col, q.row, q.yaw);
  updatePlace(true);
  updateOverlay();
}

// ---------- 出題モード ----------

function startQuiz() {
  mode = 'quiz';
  ui.eyeWrap.hidden = true;
  viewer.setSettings({ eyeHeight: 1.7 });
  setTab();
  if (!set) return;
  session = new QuizSession(set.questions, set.hm.metersPerPixel, MAP_SIZE_M);
  updatePlace(false);
  showQuestion();
}

function showQuestion() {
  if (!session) return;
  const q = session.current;
  viewer.setViewpoint(q.col, q.row, q.yaw);
  ui.quiz.hidden = false;
  ui.quizTitle.textContent = `第 ${session.index + 1} 問 / ${session.questions.length}`;
  ui.quizMsg.textContent = '3Dビューをドラッグして見回し、地図上で現在地をクリックしてください';
  setButtons({ submit: true });
  ui.quizSubmit.disabled = true;
  updateOverlay();
}

function submitGuess() {
  if (!session || !set) return;
  const a = session.submit();
  if (!a) return;
  const q = session.current;
  const elev = Math.round(sampleMeshHeight(set.hm, q.col, q.row));
  ui.quizMsg.textContent = `誤差 ${formatDist(a.distance)}　→　${a.score} 点\n正解地点の標高 ${elev} m`;
  setButtons({ next: true });
  ui.quizNext.textContent = session.isLast ? '結果を見る' : '次の問題へ';
  updateOverlay();
}

function nextQuestion() {
  if (!session) return;
  session.next();
  if (session.phase === 'guessing') {
    showQuestion();
    return;
  }
  ui.quizTitle.textContent = `結果：${session.totalScore} / ${session.maxScore} 点`;
  ui.quizMsg.textContent = session.answers.map((a, i) => `第${i + 1}問　${formatDist(a.distance)}　${a.score} 点`).join('\n');
  setButtons({ retry: true, newSet: true });
  updatePlace(true);
  updateOverlay();
}

function setButtons(show: { submit?: boolean; next?: boolean; retry?: boolean; newSet?: boolean }) {
  ui.quizSubmit.hidden = !show.submit;
  ui.quizNext.hidden = !show.next;
  ui.quizRetry.hidden = !show.retry;
  ui.quizNewSet.hidden = !show.newSet;
}

function formatDist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

// ---------- 地図の重ね描き・HUD ----------

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

  const showAltimeter = !!set && (!hideable || ui.altimeter.checked);
  ui.hudAltimeter.hidden = !showAltimeter;
  if (showAltimeter) {
    // 足元の地面の標高（目線の高さは含めない）
    ui.hudAltimeter.textContent = `標高 ${Math.round(sampleMeshHeight(set!.hm, view.col, view.row))} m`;
  }
}

function setTab() {
  $('mode-free').classList.toggle('active', mode === 'free');
  $('mode-quiz').classList.toggle('active', mode === 'quiz');
}

// ---------- イベント ----------

viewer.onViewChange = updateOverlay;

map.onClick = (col, row) => {
  if (mode === 'free') {
    viewer.setViewpoint(col, row);
  } else if (session?.setGuess(col, row)) {
    ui.quizSubmit.disabled = false;
    updateOverlay();
  }
};

map.onHover = (_c, _r, elev) => {
  ui.status.textContent = mode === 'free' ? `カーソル位置の標高 ${Math.round(elev)} m` : '';
};

function loadFromCode(code: string) {
  const spec = parseSetCode(code);
  if (!spec) {
    ui.setCode.classList.add('invalid');
    return false;
  }
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

$('mode-free').addEventListener('click', enterFree);
$('mode-quiz').addEventListener('click', startQuiz);
ui.quizSubmit.addEventListener('click', submitGuess);
ui.quizNext.addEventListener('click', nextQuestion);
ui.quizRetry.addEventListener('click', startQuiz);
ui.quizNewSet.addEventListener('click', () => newSet());
ui.compass.addEventListener('change', updateOverlay);
ui.altimeter.addEventListener('change', updateOverlay);

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

// URL の # にセットコードがあればそれを、なければ新しいセットを読み込む
if (!loadFromCode(decodeURIComponent(location.hash.slice(1)))) newSet(REGIONS[0].id);
