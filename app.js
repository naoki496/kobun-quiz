// app.js (global)

const TOTAL_QUESTIONS = 10;

// ✅音声ファイル（root/assets/ 配下）
const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3",
  wrong: "./assets/wrong.mp3"
};

let questions = [];
let order = [];
let index = 0;
let score = 0;
let locked = false;

// Combo
let combo = 0;
let maxCombo = 0;

// BGM/SE
let bgmOn = false;
let audioUnlocked = false;

const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const questionEl = document.getElementById("question");
const sublineEl = document.getElementById("subline");
const statusEl = document.getElementById("status");
const choiceBtns = Array.from(document.querySelectorAll(".choice"));
const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

const meterInner = document.getElementById("meterInner");
const meterLabel = document.getElementById("meterLabel");
const comboLabel = document.getElementById("comboLabel");

const quizEl = document.getElementById("quiz");
const bgmToggleBtn = document.getElementById("bgmToggle");

// Start screen elements (index側にある想定)
const startScreenEl = document.getElementById("startScreen");
const startBtnEl = document.getElementById("startBtn");

// Audio objects
const bgmAudio = new Audio(AUDIO_FILES.bgm);
bgmAudio.loop = true;
bgmAudio.preload = "auto";
bgmAudio.volume = 0.45;

const seCorrect = new Audio(AUDIO_FILES.correct);
seCorrect.preload = "auto";
seCorrect.volume = 0.9;

const seWrong = new Audio(AUDIO_FILES.wrong);
seWrong.preload = "auto";
seWrong.volume = 0.9;

function disableChoices(disabled) {
  choiceBtns.forEach(b => (b.disabled = disabled));
}

function shuffle(arr) {
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeRow(r) {
  // answer は "1"～"4" 想定（CSV: id question source choice1..4 answer）
  const ans = Number(String(r.answer ?? "").trim());
  if (!(ans >= 1 && ans <= 4)) {
    throw new Error(`answer が 1〜4 ではありません: "${r.answer}" (id=${r.id ?? "?"})`);
  }
  return {
    id: String(r.id ?? ""),
    question: String(r.question ?? ""),
    source: String(r.source ?? ""),
    choices: [
      String(r.choice1 ?? ""),
      String(r.choice2 ?? ""),
      String(r.choice3 ?? ""),
      String(r.choice4 ?? "")
    ],
    answer: ans
  };
}

// HTMLエスケープ
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 【】の中だけ黄色発光でハイライト
function highlightBrackets(str) {
  const safe = escapeHtml(str);
  return safe.replace(/【(.*?)】/g, '【<span class="hl">$1</span>】');
}

function updateScoreUI() {
  scoreEl.textContent = `Score: ${score}`;
}

function updateMeterUI() {
  const total = order.length || 1;
  const cur = Math.min(index + 1, total);
  const percent = Math.round((cur / total) * 100);

  meterLabel.textContent = `進捗 ${cur}/${total} (${percent}%)`;
  comboLabel.textContent = `最大COMBO x${maxCombo}`;
  meterInner.style.width = `${percent}%`;
}

function updateStatusUI(message) {
  const comboText = combo >= 2 ? ` / COMBO x${combo}` : "";
  statusEl.textContent = `${message}${comboText}`;
}

// 演出：正解フラッシュ
function flashGood() {
  quizEl.classList.remove("flash-good");
  void quizEl.offsetWidth;
  quizEl.classList.add("flash-good");
}

// 演出：不正解揺れ
function shakeBad() {
  quizEl.classList.remove("shake");
  void quizEl.offsetWidth;
  quizEl.classList.add("shake");
}

// 音：初回アンロック
async function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  try {
    bgmAudio.muted = true;
    await bgmAudio.play();
    bgmAudio.pause();
    bgmAudio.currentTime = 0;
    bgmAudio.muted = false;
  } catch (_) {
    bgmAudio.muted = false;
  }
}

async function setBgm(on) {
  bgmOn = on;

  if (bgmToggleBtn) {
    bgmToggleBtn.classList.toggle("on", bgmOn);
    bgmToggleBtn.textContent = bgmOn ? "BGM: ON" : "BGM: OFF";
  }

  if (!bgmOn) {
    try { bgmAudio.pause(); } catch (_) {}
    return;
  }

  try {
    await unlockAudioOnce();
    await bgmAudio.play();
  } catch (e) {
    console.warn(e);
    statusEl.textContent = "BGMの再生がブロックされました。もう一度BGMボタンを押してください。";
    bgmOn = false;
    if (bgmToggleBtn) {
      bgmToggleBtn.classList.remove("on");
      bgmToggleBtn.textContent = "BGM: OFF";
    }
  }
}

function playSE(which) {
  try {
    const a = which === "correct" ? seCorrect : seWrong;
    a.currentTime = 0;
    a.play();
  } catch (_) {}
}

/* ===== 星ランク（5段階） =====
  - 正答率と最大コンボの両方で評価
  - 10問想定だが、問題数が変わっても機能する
*/
function calcStarRank(score, total, maxCombo) {
  const rate = total ? score / total : 0;

  // ベース（正答率）
  let stars;
  if (rate >= 1.0) stars = 5;
  else if (rate >= 0.9) stars = 4;
  else if (rate >= 0.7) stars = 3;
  else if (rate >= 0.5) stars = 2;
  else stars = 1;

  // ボーナス（コンボが強いなら+1、ただし最大5）
  // 目安：全体の7割以上のコンボで+1（例: 10問なら maxCombo>=7）
  const comboThreshold = Math.max(3, Math.ceil(total * 0.7));
  if (maxCombo >= comboThreshold && stars < 5) stars += 1;

  // ラベル
  const label =
    stars === 5 ? "神" :
    stars === 4 ? "達人" :
    stars === 3 ? "上々" :
    stars === 2 ? "まだ伸びる" :
                  "まずは慣れ";

  return { stars, label, rate };
}

function renderStars(stars) {
  const filled = "★".repeat(stars);
  const empty = "☆".repeat(5 - stars);
  return filled + empty;
}

function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();
  updateMeterUI();

  const text = q.source ? `${q.question}（${q.source}）` : q.question;
  questionEl.innerHTML = highlightBrackets(text);

  sublineEl.textContent = "";

  choiceBtns.forEach((btn, i) => {
    btn.textContent = q.choices[i] || "---";
    btn.classList.remove("correct", "wrong");
    btn.disabled = false;
  });

  statusEl.textContent = "";
  nextBtn.disabled = true;
  locked = false;
}

function start() {
  score = 0;
  index = 0;

  combo = 0;
  maxCombo = 0;

  const pool = shuffle([...questions]);
  order = pool.slice(0, Math.min(TOTAL_QUESTIONS, pool.length));

  if (!order.length) {
    throw new Error("問題が0件です（CSVの内容を確認してください）");
  }
  render();
}

function finish() {
  const total = order.length || 1;
  const { stars, label } = calcStarRank(score, total, maxCombo);

  progressEl.textContent = "終了";

  // 上の枠（questionEl）に「結果」を集約表示
  questionEl.innerHTML =
    `<div style="font-size:18px; line-height:1.6; text-align:left;">
      <div style="font-weight:800; margin-bottom:8px;">結果：${score} / ${total}</div>
      <div style="font-size:26px; letter-spacing:0.06em; margin:6px 0 2px;">${renderStars(stars)}</div>
      <div style="opacity:0.92;">評価：<b>${label}</b>　/ 最大COMBO x${maxCombo}</div>
    </div>`;

  sublineEl.textContent = "";
  statusEl.textContent = "もう一度やるなら「最初から」";
  disableChoices(true);
  nextBtn.disabled = true;

  updateMeterUI(); // 最後も100%表示
}

function judge(selectedIdx) {
  if (locked) return;
  locked = true;
  disableChoices(true);

  const q = order[index];
  const correctIdx = q.answer - 1;

  if (selectedIdx === correctIdx) {
    score++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;

    choiceBtns[selectedIdx].classList.add("correct");
    flashGood();
    playSE("correct");
    updateStatusUI("正解");
  } else {
    combo = 0;

    choiceBtns[selectedIdx].classList.add("wrong");
    choiceBtns[correctIdx].classList.add("correct");
    shakeBad();
    playSE("wrong");
    updateStatusUI("不正解");
  }

  updateScoreUI();
  updateMeterUI();

  // 自動遷移OFF：必ず「次へ」で進む
  nextBtn.disabled = false;
}

choiceBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await unlockAudioOnce();
    const idx = Number(btn.dataset.idx);
    judge(idx);
  });
});

nextBtn.addEventListener("click", () => {
  index++;
  if (index >= order.length) {
    finish();
  } else {
    render();
  }
});

restartBtn.addEventListener("click", () => {
  try {
    start();
  } catch (e) {
    showError(e);
  }
});

if (bgmToggleBtn) {
  bgmToggleBtn.addEventListener("click", async () => {
    await unlockAudioOnce();
    await setBgm(!bgmOn);
  });
}

function showError(err) {
  console.error(err);
  progressEl.textContent = "読み込み失敗";
  scoreEl.textContent = "Score: 0";
  questionEl.textContent = "CSVを読み込めませんでした。";
  sublineEl.textContent = "";
  statusEl.textContent = `詳細: ${err?.message ?? err}`;
  disableChoices(true);
  nextBtn.disabled = true;
}

// Startボタンで「音アンロック＋BGM ON＋開始画面を消す」
async function handleStart() {
  await unlockAudioOnce();
  await setBgm(true);

  // 開始画面を消す
  if (startScreenEl) startScreenEl.style.display = "none";

  // すぐ開始
  try {
    start();
  } catch (e) {
    showError(e);
  }
}

if (startBtnEl) {
  startBtnEl.addEventListener("click", handleStart);
}

(async function boot() {
  try {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = `読み込み中…`;
    const raw = await window.CSVUtil.load(csvUrl);

    questions = raw.map(normalizeRow);

    // ✅Start画面がある場合は、ここでは start() しない
    // ✅Start画面がない場合のみ自動開始
    if (!startScreenEl) start();
  } catch (e) {
    showError(e);
  }
})();
