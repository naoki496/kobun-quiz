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

// 履歴（レビュー用）
let history = []; // [{ q, selectedIdx, correctIdx, isCorrect }]

// 学習モード
let mode = "normal"; // normal | endless

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
const modeSelect = document.getElementById("modeSelect");
const startScreenEl = document.getElementById("startScreen");
const startBtnEl = document.getElementById("startBtn");



// ===== Audio =====
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

// ===== Result Overlay（動的生成） =====
let resultOverlay = null;

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
        <button class="result-btn" id="resultRetryWrongBtn" type="button">間違いだけ復習</button>
        <button class="result-btn" id="resultCloseBtn" type="button">閉じる</button>
      </div>

      <div class="result-note">※端末の仕様で、音は最初の操作後に再生が許可されます。</div>
    </div>
  `;
  document.body.appendChild(resultOverlay);

  const rankTitleEl = resultOverlay.querySelector("#rankTitle");
  const resultSummaryEl = resultOverlay.querySelector("#resultSummary");
  const resultDetailsEl = resultOverlay.querySelector("#resultDetails");
  const starsRow = resultOverlay.querySelector("#starsRow");
  const resultBtnRestartEl = resultOverlay.querySelector("#resultRestartBtn");
  const resultBtnRetryWrongEl = resultOverlay.querySelector("#resultRetryWrongBtn");
  const resultBtnCloseEl = resultOverlay.querySelector("#resultCloseBtn");

  function hide() {
    resultOverlay.classList.add("hidden");
    resultOverlay.classList.remove("show");
  }

  resultOverlay.addEventListener("click", (e) => {
    if (e.target === resultOverlay) hide();
  });
  resultBtnCloseEl.addEventListener("click", hide);
if (startBtnEl && startScreenEl) {
  startBtnEl.addEventListener("click", async () => {
    await unlockAudioOnce();
    await setBgm(true);                  // ✅ここでBGMをON
    startScreenEl.style.display = "none"; // ✅開始画面を消す
  });
}


  
  resultBtnRestartEl.addEventListener("click", async () => {
    hide();
    await unlockAudioOnce();
    startNewSession();
  });

  resultBtnRetryWrongEl.addEventListener("click", async () => {
    hide();
    await unlockAudioOnce();
    retryWrongOnlyOnce();
  });

  // 公開関数（クロージャで持つ）
  resultOverlay._set = ({ stars, rankName, summary, details, hasWrong }) => {
    resultBtnRetryWrongEl.disabled = !hasWrong;
    resultBtnRetryWrongEl.style.opacity = hasWrong ? "" : "0.45";

    rankTitleEl.textContent = rankName;
    resultSummaryEl.textContent = summary;
    resultDetailsEl.innerHTML = details;

    const starEls = Array.from(starsRow.querySelectorAll(".star"));
    starEls.forEach((el) => el.classList.remove("on", "pop"));

    resultOverlay.classList.remove("hidden");
    void resultOverlay.offsetWidth;
    resultOverlay.classList.add("show");

    for (let i = 0; i < Math.min(5, stars); i++) {
      setTimeout(() => {
        starEls[i].classList.add("on", "pop");
      }, 120 * i);
    }
  };
}

function showResultOverlay(payload) {
  ensureResultOverlay();
  resultOverlay._set(payload);
}

// ===== Utils =====
function disableChoices(disabled) {
  choiceBtns.forEach((b) => (b.disabled = disabled));
}

function shuffle(arr) {
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

// ===== Effects =====
function flashGood() {
  quizEl.classList.remove("flash-good");
  void quizEl.offsetWidth;
  quizEl.classList.add("flash-good");
}
function shakeBad() {
  quizEl.classList.remove("shake");
  void quizEl.offsetWidth;
  quizEl.classList.add("shake");
}
function pulseNext() {
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

// ===== Rendering / Session =====
function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();
  updateMeterUI();

  const text = q.source ? `${q.question}（${q.source}）` : q.question;
  questionEl.innerHTML = highlightBrackets(text);

  // サブラインは“空”で良い（必要なら「ヒント」等に転用）
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

function startWithPool(pool) {
  score = 0;
  index = 0;
  combo = 0;
  maxCombo = 0;
  history = [];

  if (!pool.length) throw new Error("問題が0件です（CSVの内容を確認してください）");

  // normal/endless ともに、まずは最大10問で開始（endlessは後で“間違いだけ”を回す）
  const shuffled = shuffle([...pool]);
  order = shuffled.slice(0, Math.min(TOTAL_QUESTIONS, shuffled.length));

  ensureResultOverlay();
  render();
}

function startNewSession() {
  startWithPool([...questions]);
}

function retryWrongOnlyOnce() {
  const wrong = history.filter(h => !h.isCorrect).map(h => h.q);
  if (!wrong.length) {
    startNewSession();
    return;
  }
  startWithPool(wrong);
}

// ===== Result / Rank =====
function getUserMessageByRate(percent) {
  if (percent >= 90) return "素晴らしい！この調子！";
  if (percent >= 70) return "よく覚えられているぞ！";
  if (percent >= 40) return "ここから更に積み重ねよう！";
  return "まずは基礎単語から始めよう！";
}

function calcStars(score0, total) {
  const percent = total ? (score0 / total) * 100 : 0;
  if (percent >= 90) return 5;
  if (percent >= 80) return 4;
  if (percent >= 65) return 3;
  if (percent >= 50) return 2;
  return 1;
}

function calcRankName(stars, maxCombo0) {
  // コンボで1段階だけ底上げ（やり過ぎない）
  const boost = maxCombo0 >= 6 ? 1 : 0;
  const s = Math.min(5, Math.max(1, stars + boost));
  const table = { 1:"見習い", 2:"一人前", 3:"職人", 4:"達人", 5:"神" };
  return table[s];
}

function buildReviewHtml() {
  const wrong = history.filter(h => !h.isCorrect);
  if (!wrong.length) {
    return `
      <div class="review-title">復習</div>
      <div class="review-empty">全問正解。復習項目はありません。</div>
    `;
  }

  const items = wrong.map((h, idx) => {
    const q = h.q;
    const qText = q.source ? `${q.question}（${q.source}）` : q.question;

    const choicesHtml = q.choices.map((c, i) => {
      const isC = i === h.correctIdx;
      const isS = i === h.selectedIdx;
      const cls = ["rv-choice", isC ? "is-correct" : "", isS ? "is-selected" : ""].filter(Boolean).join(" ");
      const badge = isC ? "正解" : (isS ? "選択" : "");
      return `
        <div class="${cls}">
          <div class="rv-badge">${badge}</div>
          <div class="rv-text">${escapeHtml(c)}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="review-item">
        <div class="review-q">
          <span class="review-no">#${idx + 1}</span>
          <span class="review-qtext">${highlightBrackets(qText)}</span>
        </div>
        <div class="review-choices">${choicesHtml}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="review-title">復習（間違いのみ ${wrong.length} 件）</div>
    <div class="review-list">${items}</div>
  `;
}

function finishAndShowResult() {
  progressEl.textContent = "終了";
  disableChoices(true);
  nextBtn.disabled = true;

  const total = order.length || 1;
  const percent = Math.round((score / total) * 100);

  const stars = calcStars(score, total);
  const rank = calcRankName(stars, maxCombo);

  const message = getUserMessageByRate(percent);
  const hasWrong = history.some(h => !h.isCorrect);

  const details = `
    <div class="result-message">${escapeHtml(message)}</div>

    <div class="kv">
      <div class="k">正答率</div><div class="v">${percent}%</div>
      <div class="k">最大COMBO</div><div class="v">x${maxCombo}</div>
      <div class="k">モード</div><div class="v">${mode === "endless" ? "連続学習" : "通常"}</div>
    </div>

    ${buildReviewHtml()}
  `;

  showResultOverlay({
    stars,
    rankName: `${rank}`,
    summary: `スコア ${score}/${total}（正答率 ${percent}%）`,
    details,
    hasWrong
  });

  // overlayを閉じても最低限見えるように
  questionEl.textContent = `結果：${score} / ${total}`;
  sublineEl.textContent = "";
  statusEl.textContent = "おつかれさまでした。";
}

// ===== Endless logic（間違い0まで） =====
function continueEndlessIfNeeded() {
  // 今ラウンドの誤答を集める
  const wrongQs = history.filter(h => !h.isCorrect).map(h => h.q);

  if (!wrongQs.length) {
    // ✅誤答0達成
    finishAndShowResult();
    return;
  }

  // ✅誤答が残っている → “間違いだけ”で次ラウンド
  index = 0;
  combo = 0;
  history = [];

  // 次ラウンドは“誤答だけ”から最大10問
  const shuffled = shuffle([...wrongQs]);
  order = shuffled.slice(0, Math.min(TOTAL_QUESTIONS, shuffled.length));

  // ここで score は「累積」のままにする（達成感重視）
  // もしラウンド毎にスコアを出したいならここでscoreを別管理します。

  render();
}

// ===== Judge =====
function judge(selectedIdx) {
  if (locked) return;
  locked = true;
  disableChoices(true);

  const q = order[index];
  const correctIdx = q.answer - 1;
  const isCorrect = selectedIdx === correctIdx;

  history.push({ q, selectedIdx, correctIdx, isCorrect });

  if (isCorrect) {
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

  // 自動遷移OFF：必ず「次へ」
  nextBtn.disabled = false;
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

nextBtn.addEventListener("click", () => {
  nextBtn.disabled = true;

  // テンポ最適化：誤操作を抑える最小ディレイ
  setTimeout(() => {
    index++;

    if (index >= order.length) {
      if (mode === "endless") {
        continueEndlessIfNeeded();
      } else {
        finishAndShowResult();
      }
    } else {
      render();
    }
  }, 120);
});

restartBtn.addEventListener("click", () => {
  try {
    startNewSession();
  } catch (e) {
    showError(e);
  }
});

bgmToggleBtn.addEventListener("click", async () => {
  await unlockAudioOnce();
  await setBgm(!bgmOn);
});

modeSelect.addEventListener("change", () => {
  mode = modeSelect.value;
  try {
    startNewSession();
  } catch (e) {
    showError(e);
  }
});

// ===== Error =====
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

// ===== Boot =====
(async function boot() {
  try {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = "読み込み中…";
    const raw = await window.CSVUtil.load(csvUrl);

    questions = raw.map(normalizeRow);

    modeSelect.value = mode;

    ensureResultOverlay();
    startNewSession();
  } catch (e) {
    showError(e);
  }
})();
