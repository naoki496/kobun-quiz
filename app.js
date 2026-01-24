// app.js (global)

const TOTAL_QUESTIONS = 10;

// ✅音声ファイル（root/asset/ 配下）
const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3", // ご指定のファイル名をそのまま使用
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

  bgmToggleBtn.classList.toggle("on", bgmOn);
  bgmToggleBtn.textContent = bgmOn ? "BGM: ON" : "BGM: OFF";

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
    bgmToggleBtn.classList.remove("on");
    bgmToggleBtn.textContent = "BGM: OFF";
  }
}

function playSE(which) {
  try {
    const a = which === "correct" ? seCorrect : seWrong;
    a.currentTime = 0;
    a.play();
  } catch (_) {}
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
  progressEl.textContent = "終了";
  questionEl.textContent = `結果：${score} / ${order.length}`;
  sublineEl.textContent = "";
  statusEl.textContent = `おつかれさまでした。最大COMBO x${maxCombo}`;
  disableChoices(true);
  nextBtn.disabled = true;
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

bgmToggleBtn.addEventListener("click", async () => {
  await unlockAudioOnce();
  await setBgm(!bgmOn);
});

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
    start();
  } catch (e) {
    showError(e);
  }
})();
