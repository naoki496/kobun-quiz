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

// カテゴリ
let currentCategory = "__all__";

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

const categorySelect = document.getElementById("categorySelect");
const modeSelect = document.getElementById("modeSelect");

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
let starsRow = null;
let rankTitleEl = null;
let resultSummaryEl = null;
let resultDetailsEl = null;
let resultBtnRestartEl = null;
let resultBtnRetryWrongEl = null;
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
        <button class="result-btn" id="resultRetryWrongBtn" type="button">間違いだけ復習</button>
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
  resultBtnRetryWrongEl = resultOverlay.querySelector("#resultRetryWrongBtn");
  resultBtnCloseEl = resultOverlay.querySelector("#resultCloseBtn");

  resultOverlay.addEventListener("click", (e) => {
    if (e.target === resultOverlay) hideResultOverlay();
  });

  resultBtnCloseEl.addEventListener("click", hideResultOverlay);

  resultBtnRestartEl.addEventListener("click", async () => {
    hideResultOverlay();
    try {
      await unlockAudioOnce();
      startNewSession();
    } catch (e) {
      showError(e);
    }
  });

  resultBtnRetryWrongEl.addEventListener("click", async () => {
    hideResultOverlay();
    try {
      await unlockAudioOnce();
      retryWrongOnlyOnce();
    } catch (e) {
      showError(e);
    }
  });
}

function showResultOverlay({ stars, rankName, summary, details, hasWrong }) {
  ensureResultOverlay();

  resultBtnRetryWrongEl.disabled = !hasWrong;
  resultBtnRetryWrongEl.style.opacity = hasWrong ? "" : "0.45";

  const starEls = Array.from(starsRow.querySelectorAll(".star"));
  starEls.forEach((el) => {
    el.classList.remove("on", "pop");
  });

  rankTitleEl.textContent = rankName;
  resultSummaryEl.textContent = summary;
  resultDetailsEl.innerHTML = details;

  resultOverlay.classList.remove("hidden");
  void resultOverlay.offsetWidth;
  resultOverlay.classList.add("show");

  for (let i = 0; i < Math.min(5, stars); i++) {
    setTimeout(() => {
      starEls[i].classList.add("on", "pop");
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
    category: String(r.category ?? "").trim() || "未分類", // ✅追加（なくてもOK）
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

// ===== Category / Mode =====
function getCategoryList(data) {
  const set = new Set();
  data.forEach(q => set.add(q.category || "未分類"));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
}

function fillCategorySelect() {
  const cats = getCategoryList(questions);
  categorySelect.innerHTML = `
    <option value="__all__">すべて</option>
    ${cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
  `;
  categorySelect.value = currentCategory;
}

function getFilteredPool() {
  let pool = [...questions];
  if (currentCategory !== "__all__") {
    pool = pool.filter(q => q.category === currentCategory);
  }
  return pool;
}

// ===== Rendering / Session =====
function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();
  updateMeterUI();

  // 問題文は上の枠に統一（出典は同枠内に軽く埋める）
  const text = q.source ? `${q.question}（${q.source}）` : q.question;
  questionEl.innerHTML = highlightBrackets(text);

  // サブライン：カテゴリ表示（任意）
  sublineEl.textContent = q.category ? `カテゴリ：${q.category}` : "";

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

  if (!pool.length) {
    throw new Error("出題プールが0件です（カテゴリ絞り込みやCSVを確認してください）");
  }

  const shuffled = shuffle([...pool]);

  // normal: TOTAL_QUESTIONS問、endless: まずTOTAL_QUESTIONS問スタート（以後、誤答0までループ）
  order = shuffled.slice(0, Math.min(TOTAL_QUESTIONS, shuffled.length));

  hideResultOverlay();
  render();
}

function startNewSession() {
  const pool = getFilteredPool();
  startWithPool(pool);
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
  // ユーザー指定を厳密適用
  if (percent >= 90) return "素晴らしい！この調子！";
  if (percent >= 70) return "よく覚えられているぞ！";
  if (percent >= 40) return "ここから更に積み重ねよう！";
  return "まずは基礎単語から始めよう！";
}

function calcStars(score, total) {
  const percent = total ? (score / total) * 100 : 0;
  if (percent >= 90) return 5;
  if (percent >= 80) return 4;
  if (percent >= 65) return 3;
  if (percent >= 50) return 2;
  return 1;
}

function calcRankName(stars, maxCombo) {
  // コンボが強い場合に“1段階だけ”底上げ（やりすぎない）
  const boost = maxCombo >= 6 ? 1 : 0;
  const s = Math.min(5, Math.max(1, stars + boost));
  const table = {
    1: "見習い",
    2: "一人前",
    3: "職人",
    4: "達人",
    5: "神"
  };
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
        <div class="review-foot">
          <span>カテゴリ：<b>${escapeHtml(q.category || "未分類")}</b></span>
          <span>あなたの選択：<b>${escapeHtml(q.choices[h.selectedIdx] ?? "")}</b></span>
          <span>正解：<b>${escapeHtml(q.choices[h.correctIdx] ?? "")}</b></span>
        </div>
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
      <div class="k">カテゴリ</div><div class="v">${escapeHtml(currentCategory === "__all__" ? "すべて" : currentCategory)}</div>
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

  // 保険表示（overlayを閉じても最低限見えるように）
  questionEl.textContent = `結果：${score} / ${total}`;
  sublineEl.textContent = "";
}

// ===== Endless logic（間違い0まで） =====
function continueEndlessIfNeeded() {
  const wrong = history.filter(h => !h.isCorrect).map(h => h.q);
  if (!wrong.length) {
    // ✅間違い0達成 → 結果表示（達成感を最大化）
    finishAndShowResult();
    return;
  }

  // ✅間違いが残っている → それだけで次ラウンド
  // スコアは「今回ラウンドのもの」なので、ここでリセットしない（学習感を優先）
  // ただし “ラウンド” 表示をしたいなら subline等に出せます（今回はUI維持優先）

  // 次ラウンド準備
  index = 0;
  combo = 0;
  maxCombo = Math.max(maxCombo, maxCombo); // 意味はないが可読性のため残す
  history = []; // 次ラウンドの誤答判定は新しく取り直し（学習として自然）

  order = shuffle([...wrong]).slice(0, Math.min(TOTAL_QUESTIONS, wrong.length));

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
  // 押しミス対策：即無効化
  nextBtn.disabled = true;

  // テンポ最適化：ほんの少しだけ間を置く（体感のキレを残しつつ誤操作を抑える）
  setTimeout(() => {
    index++;

    if (index >= order.length) {
      // ここでモード分岐
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

categorySelect.addEventListener("change", () => {
  const v = categorySelect.value;
  currentCategory = v;
  try {
    startNewSession();
  } catch (e) {
    showError(e);
  }
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

    // フィルタUI初期化
    fillCategorySelect();

    // モードUI初期化
    modeSelect.value = mode;

    ensureResultOverlay();
    hideResultOverlay();

    startNewSession();
  } catch (e) {
    showError(e);
  }
})();
