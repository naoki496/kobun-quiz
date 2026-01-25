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

// DOM
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

// ===== Audio objects =====
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

// ===== Result Overlay (dynamic) =====
let resultOverlay = null;
let starsRow = null;
let rankTitleEl = null;
let resultSummaryEl = null;
let resultDetailsEl = null;
let resultBtnRestartEl = null;
let resultBtnCloseEl = null;

function ensureResultOverlay() {
  if (resultOverlay) return;

  resultOverlay = document.createElement("div");
  resultOverlay.id = "resultOverlay";
  resultOverlay.className = "result-overlay hidden";
  resultOverlay.innerHTML = `
    <div class="result-card" role="dialog" aria-modal="true" aria-label="結果">
      <div class="result-head">
        <div class="result-rank" id="rankTitle">RESULT</div>
        <div class="result-sub" id="resultSummary">---</div>
      </div>

      <div class="stars" id="starsRow" aria-label="星評価">
        ${Array.from({ length: 5 }).map(() => `<span class="star">★</span>`).join("")}
      </div>

      <div class="result-details" id="resultDetails">---</div>

      <div class="result-actions">
        <button class="result-btn primary" id="resultRestartBtn" type="button">もう一回</button>
        <button class="result-btn" id="resultCloseBtn" type="button">閉じる</button>
      </div>

      <div class="result-note">※BGMは端末の仕様で、最初の操作後に再生が許可されます。</div>
    </div>
  `;

  document.body.appendChild(resultOverlay);

  starsRow = resultOverlay.querySelector("#starsRow");
  rankTitleEl = resultOverlay.querySelector("#rankTitle");
  resultSummaryEl = resultOverlay.querySelector("#resultSummary");
  resultDetailsEl = resultOverlay.querySelector("#resultDetails");
  resultBtnRestartEl = resultOverlay.querySelector("#resultRestartBtn");
  resultBtnCloseEl = resultOverlay.querySelector("#resultCloseBtn");

  // Overlay click to close (only outside card)
  resultOverlay.addEventListener("click", (e) => {
    if (e.target === resultOverlay) hideResultOverlay();
  });

  resultBtnCloseEl.addEventListener("click", hideResultOverlay);

  resultBtnRestartEl.addEventListener("click", async () => {
    hideResultOverlay();
    try {
      await unlockAudioOnce();
      start();
      // 次へ押下誤爆防止：開始時は disabled のまま
    } catch (e) {
      showError(e);
    }
  });
}

function showResultOverlay({ stars, rankName, summary, details }) {
  ensureResultOverlay();

  // reset stars
  const starEls = Array.from(starsRow.querySelectorAll(".star"));
  starEls.forEach((el) => {
    el.classList.remove("on");
    el.classList.remove("pop");
  });

  rankTitleEl.textContent = rankName;
  resultSummaryEl.textContent = summary;
  resultDetailsEl.innerHTML = details;

  resultOverlay.classList.remove("hidden");
  // trigger animation
  void resultOverlay.offsetWidth;
  resultOverlay.classList.add("show");

  // star-by-star animation
  for (let i = 0; i < Math.min(5, stars); i++) {
    setTimeout(() => {
      starEls[i].classList.add("on");
      starEls[i].classList.add("pop");
    }, 120 * i);
  }
}

function hideResultOverlay() {
  if (!resultOverlay) return;
  resultOverlay.classList.add("hidden");
  resultOverlay.classList.remove("show");
}

// ===== Utils =====
function disableChoices(disabled) {
  choiceBtns.forEach((b) => (b.disabled = disabled));
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

// HTML escape
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 【】 highlight
function highlightBrackets(str) {
  const safe = escapeHtml(str);
  return safe.replace(/【(.*?)】/g, '【<span class="hl">$1</span>】');
}

function updateScoreUI() {
  if (scoreEl) scoreEl.textContent = `Score: ${score}`;
}

function updateMeterUI() {
  const total = order.length || 1;
  const cur = Math.min(index + 1, total);
  const percent = Math.round((cur / total) * 100);

  if (meterLabel) meterLabel.textContent = `進捗 ${cur}/${total} (${percent}%)`;
  if (comboLabel) comboLabel.textContent = `最大COMBO x${maxCombo}`;
  if (meterInner) meterInner.style.width = `${percent}%`;
}

function updateStatusUI(message) {
  const comboText = combo >= 2 ? ` / COMBO x${combo}` : "";
  if (statusEl) statusEl.textContent = `${message}${comboText}`;
}

// ===== Effects =====
function flashGood() {
  if (!quizEl) return;
  quizEl.classList.remove("flash-good");
  void quizEl.offsetWidth;
  quizEl.classList.add("flash-good");
}

function shakeBad() {
  if (!quizEl) return;
  quizEl.classList.remove("shake");
  void quizEl.offsetWidth;
  quizEl.classList.add("shake");
}

function pulseNext() {
  if (!nextBtn) return;
  nextBtn.classList.remove("pulse-next");
  void nextBtn.offsetWidth;
  nextBtn.classList.add("pulse-next");
}

// ===== Audio =====
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
    if (statusEl) statusEl.textContent = "BGMの再生がブロックされました。もう一度BGMボタンを押してください。";
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

// ===== Rendering =====
function render() {
  const q = order[index];

  if (progressEl) progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();
  updateMeterUI();

  const text = q.source ? `${q.question}（${q.source}）` : q.question;
  if (questionEl) questionEl.innerHTML = highlightBrackets(text);

  if (sublineEl) sublineEl.textContent = "";

  choiceBtns.forEach((btn, i) => {
    btn.textContent = q.choices[i] || "---";
    btn.classList.remove("correct", "wrong");
    btn.disabled = false;
  });

  if (statusEl) statusEl.textContent = "";
  if (nextBtn) nextBtn.disabled = true;
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

  hideResultOverlay();
  render();
}

function calcStarsAndRank(score, total, maxCombo) {
  const rate = total ? (score / total) : 0;
  const percent = Math.round(rate * 100);

  // 星：学習用途でも納得しやすい「正答率主体」
  // 5: 90-100 / 4: 80-89 / 3: 65-79 / 2: 50-64 / 1: <50
  let stars = 1;
  if (percent >= 90) stars = 5;
  else if (percent >= 80) stars = 4;
  else if (percent >= 65) stars = 3;
  else if (percent >= 50) stars = 2;

  // ランク名（ゲーム風）
  // ※コンボが高いと“称号が少し強く見える”ように微調整
  const comboBoost = maxCombo >= 6 ? 1 : 0;
  const rankTable = [
    { s: 1, name: "見習い" },
    { s: 2, name: "一人前" },
    { s: 3, name: "職人" },
    { s: 4, name: "達人" },
    { s: 5, name: "神" }
  ];
  const rank = rankTable[Math.min(4, Math.max(0, stars - 1 + comboBoost))].name;

  return { stars, rank, percent };
}

function finish() {
  // 画面側の「表示」は Overlay に寄せる（UI崩れ防止）
  if (progressEl) progressEl.textContent = "終了";
  if (sublineEl) sublineEl.textContent = "";
  if (statusEl) statusEl.textContent = "";
  disableChoices(true);
  if (nextBtn) nextBtn.disabled = true;

  const total = order.length || 1;
  const { stars, rank, percent } = calcStarsAndRank(score, total, maxCombo);

  const summary = `スコア ${score}/${total}（正答率 ${percent}%）`;

  // details は HTML 可（表示は overlay 内のみ）
  const details = `
    <div class="kv">
      <div class="k">正答率</div><div class="v">${percent}%</div>
      <div class="k">最大COMBO</div><div class="v">x${maxCombo}</div>
      <div class="k">出題数</div><div class="v">${total}</div>
    </div>
  `;

  showResultOverlay({
    stars,
    rankName: `${rank}`,
    summary,
    details
  });

  // 背景に結果だけ出す（保険。overlayが何かで消えても最低限分かる）
  if (questionEl) questionEl.textContent = `結果：${score} / ${total}`;
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
  if (nextBtn) nextBtn.disabled = false;
  pulseNext();
}

// ===== Events =====
choiceBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await unlockAudioOnce();
    const idx = Number(btn.dataset.idx);
    judge(idx);
  });
});

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    // 連打対策（体感の安定）
    nextBtn.disabled = true;
    setTimeout(() => {
      index++;
      if (index >= order.length) {
        finish();
      } else {
        render();
      }
    }, 120);
  });
}

if (restartBtn) {
  restartBtn.addEventListener("click", () => {
    try {
      start();
    } catch (e) {
      showError(e);
    }
  });
}

if (bgmToggleBtn) {
  bgmToggleBtn.addEventListener("click", async () => {
    await unlockAudioOnce();
    await setBgm(!bgmOn);
  });
}

function showError(err) {
  console.error(err);
  if (progressEl) progressEl.textContent = "読み込み失敗";
  if (scoreEl) scoreEl.textContent = "Score: 0";
  if (questionEl) questionEl.textContent = "CSVを読み込めませんでした。";
  if (sublineEl) sublineEl.textContent = "";
  if (statusEl) statusEl.textContent = `詳細: ${err?.message ?? err}`;
  disableChoices(true);
  if (nextBtn) nextBtn.disabled = true;
}

(async function boot() {
  try {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    if (progressEl) progressEl.textContent = `読み込み中…`;
    const raw = await window.CSVUtil.load(csvUrl);

    questions = raw.map(normalizeRow);

    // 起動直後は overlay 非表示のまま
    ensureResultOverlay();
    hideResultOverlay();

    start();
  } catch (e) {
    showError(e);
  }
})();
