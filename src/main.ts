import './style.css';
import { ContourMap, type Marker, type MapLine } from './contourMap';
import { loadRealTerrain } from './dem';
import { REGIONS, randomCenter } from './regions';
import { initialYaw, pickSpots, scoreForDistance, type Spot } from './spots';
import type { Heightmap } from './terrain';
import { sampleMeshHeight } from './terrain';
import { Viewer3D } from './viewer3d';

const MAP_SIZE_M = 4000;
const MARGIN_M = 3000;
const QUESTIONS = 5;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const regionSel = $<HTMLSelectElement>('region');
const statusEl = $('status');
const placeEl = $('place');
const loadingEl = $('loading');
const hudCompass = $('hud-compass');
const quizEl = $('quiz');
const quizTitle = $('quiz-title');
const quizMsg = $('quiz-msg');
const quizSubmit = $<HTMLButtonElement>('quiz-submit');
const quizNext = $<HTMLButtonElement>('quiz-next');
const quizRetry = $<HTMLButtonElement>('quiz-retry');
const compassChk = $<HTMLInputElement>('compass');
const hudAltimeter = $('hud-altimeter');
const altimeterChk = $<HTMLInputElement>('altimeter');
const eyeWrap = $('eye-wrap');

for (const r of REGIONS) regionSel.add(new Option(r.name, r.id));

const map = new ContourMap($('map'));
const viewer = new Viewer3D($('view'));

type Mode = 'free' | 'quiz';
interface QuizState {
  spots: Spot[];
  index: number;
  guesses: ({ col: number; row: number } | null)[];
  scores: number[];
  distances: number[];
  phase: 'guessing' | 'revealed' | 'finished';
}

let hm: Heightmap | null = null;
let mode: Mode = 'free';
let quiz: QuizState | null = null;
let loadAbort: AbortController | null = null;

// ---------- 地図の読み込み ----------

async function loadNewMap() {
  const region = REGIONS.find((r) => r.id === regionSel.value)!;
  const c = randomCenter(region);
  loadAbort?.abort();
  const abort = (loadAbort = new AbortController());
  loadingEl.hidden = false;
  loadingEl.textContent = '標高データを読み込み中…';
  try {
    const t = await loadRealTerrain(
      c.lat,
      c.lon,
      region.name,
      {
        mapSizeMeters: MAP_SIZE_M,
        marginMeters: MARGIN_M,
        onProgress: (d, n) => (loadingEl.textContent = `標高データを読み込み中… ${d} / ${n} タイル`),
      },
      abort.signal,
    );
    if (abort.signal.aborted) return;
    loadingEl.textContent = '地形を構築中…';
    await new Promise((r) => setTimeout(r, 0));
    hm = t;
    map.setTerrain(t);
    viewer.setTerrain(t);
    if (mode === 'quiz') startQuiz();
    else enterFree();
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    console.error(e);
    loadingEl.textContent = `読み込みに失敗しました：${(e as Error).message}`;
    return;
  }
  loadingEl.hidden = true;
}

function updatePlace(show: boolean) {
  if (!hm?.center || !show) {
    placeEl.textContent = '';
    return;
  }
  const { lat, lon } = hm.center;
  placeEl.innerHTML = `${hm.label}　${lat.toFixed(4)}, ${lon.toFixed(4)}　<a href="https://maps.gsi.go.jp/#14/${lat.toFixed(5)}/${lon.toFixed(5)}/" target="_blank" rel="noopener">地理院地図で見る</a>`;
}

// ---------- 自由モード ----------

function enterFree() {
  mode = 'free';
  quiz = null;
  quizEl.hidden = true;
  eyeWrap.hidden = false;
  setTab();
  if (!hm) return;
  const { col0, row0, size } = hm.mapRect;
  // 地図の中心付近で見通しの良い地点から始める
  const s = pickSpots(hm, 1)[0] ?? { col: col0 + size / 2, row: row0 + size / 2 };
  viewer.setViewpoint(s.col, s.row, 0);
  updatePlace(true);
  updateOverlay();
}

// ---------- 出題モード ----------

function startQuiz() {
  mode = 'quiz';
  eyeWrap.hidden = true;
  viewer.setSettings({ eyeHeight: 1.7 });
  setTab();
  if (!hm) return;
  const spots = pickSpots(hm, QUESTIONS);
  quiz = { spots, index: 0, guesses: [], scores: [], distances: [], phase: 'guessing' };
  updatePlace(false);
  showQuestion();
}

function showQuestion() {
  if (!quiz) return;
  const s = quiz.spots[quiz.index];
  quiz.phase = 'guessing';
  quiz.guesses[quiz.index] = null;
  viewer.setViewpoint(s.col, s.row, initialYaw(hm!, s.col, s.row));
  quizEl.hidden = false;
  quizTitle.textContent = `第 ${quiz.index + 1} 問 / ${QUESTIONS}`;
  quizMsg.textContent = '3Dビューをドラッグして見回し、地図上で現在地をクリックしてください';
  quizSubmit.hidden = false;
  quizSubmit.disabled = true;
  quizNext.hidden = true;
  quizRetry.hidden = true;
  updateOverlay();
}

function submitGuess() {
  if (!quiz || !hm) return;
  const g = quiz.guesses[quiz.index];
  if (!g) return;
  const s = quiz.spots[quiz.index];
  const dist = Math.hypot(g.col - s.col, g.row - s.row) * hm.metersPerPixel;
  const score = scoreForDistance(dist, MAP_SIZE_M);
  quiz.distances[quiz.index] = dist;
  quiz.scores[quiz.index] = score;
  quiz.phase = 'revealed';
  const elev = Math.round(sampleMeshHeight(hm, s.col, s.row));
  quizMsg.textContent = `誤差 ${formatDist(dist)}　→　${score} 点\n正解地点の標高 ${elev} m`;
  quizSubmit.hidden = true;
  quizNext.hidden = false;
  quizNext.textContent = quiz.index + 1 < QUESTIONS ? '次の問題へ' : '結果を見る';
  updateOverlay();
}

function nextQuestion() {
  if (!quiz) return;
  if (quiz.index + 1 < QUESTIONS) {
    quiz.index++;
    showQuestion();
    return;
  }
  quiz.phase = 'finished';
  const total = quiz.scores.reduce((a, b) => a + b, 0);
  quizTitle.textContent = `結果：${total} / ${QUESTIONS * 5000} 点`;
  quizMsg.textContent = quiz.distances.map((d, i) => `第${i + 1}問　${formatDist(d)}　${quiz!.scores[i]} 点`).join('\n');
  quizNext.hidden = true;
  quizRetry.hidden = false;
  updatePlace(true);
  updateOverlay();
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
  } else if (quiz) {
    quiz.spots.forEach((s, i) => {
      const g = quiz!.guesses[i];
      const current = i === quiz!.index;
      const answered = i < quiz!.index || (current && quiz!.phase !== 'guessing');
      if (current && quiz!.phase === 'guessing') {
        if (g) markers.push({ ...g, kind: 'guess' });
        return;
      }
      if (!answered) return;
      const isPast = !current && quiz!.phase !== 'finished';
      if (g) {
        lines.push({ from: g, to: s });
        markers.push({ ...g, kind: isPast ? 'past-guess' : 'guess' });
      }
      markers.push({
        col: s.col,
        row: s.row,
        kind: isPast ? 'past-answer' : 'answer',
        label: String(i + 1),
        ...(current ? { yaw: view.yaw, hfov: view.hfov } : {}),
      });
    });
  }
  map.setOverlay(markers, lines);

  // 回答前の出題中だけ、設定に応じてコンパス・標高計を隠す
  const hideable = mode === 'quiz' && quiz?.phase === 'guessing';
  const showCompass = !hideable || compassChk.checked;
  hudCompass.hidden = !showCompass;
  if (showCompass) {
    const deg = Math.round((viewer.yaw * 180) / Math.PI) % 360;
    const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
    hudCompass.textContent = `${dirs[Math.round(deg / 45) % 8]}　${String(deg).padStart(3, '0')}°`;
  }

  const showAltimeter = !!hm && (!hideable || altimeterChk.checked);
  hudAltimeter.hidden = !showAltimeter;
  if (showAltimeter) {
    // 足元の地面の標高（目線の高さは含めない）
    const elev = Math.round(sampleMeshHeight(hm!, view.col, view.row));
    hudAltimeter.textContent = `標高 ${elev} m`;
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
  } else if (quiz && quiz.phase === 'guessing') {
    quiz.guesses[quiz.index] = { col, row };
    quizSubmit.disabled = false;
    updateOverlay();
  }
};

map.onHover = (_c, _r, elev) => {
  statusEl.textContent = mode === 'free' ? `カーソル位置の標高 ${Math.round(elev)} m` : '';
};

$('new-map').addEventListener('click', loadNewMap);
regionSel.addEventListener('change', loadNewMap);
$('mode-free').addEventListener('click', enterFree);
$('mode-quiz').addEventListener('click', startQuiz);
quizSubmit.addEventListener('click', submitGuess);
quizNext.addEventListener('click', nextQuestion);
quizRetry.addEventListener('click', startQuiz);
compassChk.addEventListener('change', updateOverlay);
altimeterChk.addEventListener('change', updateOverlay);

$<HTMLSelectElement>('interval').addEventListener('change', (e) =>
  map.setSettings({ interval: Number((e.target as HTMLSelectElement).value) }),
);
$<HTMLInputElement>('labels').addEventListener('change', (e) =>
  map.setSettings({ labels: (e.target as HTMLInputElement).checked }),
);
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

loadNewMap();
