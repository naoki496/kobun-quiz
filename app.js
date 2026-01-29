// app.js (global)

const TOTAL_QUESTIONS = 10;

// ✅音声ファイル（root/assets/ 配下）
const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3",
  wrong: "./assets/wrong.mp3",
};

// ===== Card (Reward) =====
// ★3/★4/★5の抽選プール（まずは仮で3枚）
const CARD_POOL = {
  3: [{ id: "sei_shonagon", name: "清少納言", img: "./assets/cards/sei_shonagon.png" }],
  4: [{ id: "murasaki", name: "紫式部", img: "./assets/cards/murasaki.png" }],
  5: [{ id: "basho", name: "松尾芭蕉", img: "./assets/cards/basho.png" }],
};

let questions = [];
let order = [];
let index = 0;
let score = 0;
let locked = false;

// Combo
let combo = 0;
let maxCombo = 0;

// mode
// normal: 10問
// endless: 連続学習（終了後、間違いだけ復習ボタンが出る）
let mode = "normal";

// history（復習用）
let history = [];

// BGM/SE
let bgmOn = false;
let audioUnlocked = false;

// ===== DOM =====
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
const modePillEl = document.getElementById("modePill");

// Start Screen
const startScreenEl = document.getElementById("startScreen");
const startBtnEl = document.getElementById("startBtn");
const startNoteEl = document.getElementById("startNote");
const modeNormalBtn = document.getElementById("modeNormalBtn");
const modeEndlessBtn = document.getElementById("modeEndlessBtn");

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

// ===== SE Pool（同一結果が連続しても鳴らすため）=====
const SE_POOL_SIZE = 4;

function makeSEPool(src, volume) {
  const pool = Array.from({ length: SE_POOL_SIZE }, () => {
    const a = new Audio(src);
    a.preload = "auto";
    a.volume = volume;
    return a;
  });
  let idx = 0;
  return {
    play() {
      const a = pool[idx];
      idx = (idx + 1) % pool.length;
      try {
        a.pause();          // 念のため停止
        a.currentTime = 0;  // 巻き戻し
        const p = a.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch (_) {}
    },
  };
}

const seCorrectPool = makeSEPool(AUDIO_FILES.correct, 0.9);
const seWrongPool = makeSEPool(AUDIO_FILES.wrong, 0.9);

// ===== Storage (localStorage 可用性チェック + フォールバック) =====
const STORAGE_KEY_CARD_COUNTS = "kobunQuiz.v1.cardCounts";

function storageAvailable() {
  try {
    const x = "__storage_test__";
    window.localStorage.setItem(x, x);
    window.localStorage.removeItem(x);
    return true;
  } catch {
    return false;
  }
}

const StorageAdapter = (() => {
  const mem = new Map();
  const ok = storageAvailable();

  return {
    // true: localStorage 永続 / false: メモリ（リロードで消える）
    isPersistent: ok,

    get(key) {
      if (ok) return window.localStorage.getItem(key);
      return mem.get(key) ?? null;
    },

    set(key, value) {
      // QuotaExceededError 等を握り潰さず、落とさない
      try {
        if (ok) window.localStorage.setItem(key, value);
        else mem.set(key, value);
      } catch (e) {
        // localStorage が突然使えない/満杯 の場合はメモリへ退避
        mem.set(key, value);
        console.warn("[StorageAdapter] localStorage write failed; fallback to memory.", e);
      }
    },
  };
})();

function loadCardCounts() {
  const raw = StorageAdapter.get(STORAGE_KEY_CARD_COUNTS);
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveCardCounts(counts) {
  StorageAdapter.set(STORAGE_KEY_CARD_COUNTS, JSON.stringify(counts));
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

function normalizeAnswer(raw) {
  // 全角数字（１〜４）や余計な空白・文字を吸収して 1〜4 の数値に正規化
  const s = String(raw ?? "")
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[^\d]/g, "");
  return Number(s);
}

function normalizeRow(r) {
  // answer は "1"～"4" 想定（CSV: id question source choice1..4 answer）
  const ans = normalizeAnswer(r.answer);
  if (!(ans >= 1 && ans <= 4)) {
    throw new Error(`answer が 1〜4 ではありません: "${r.answer}" (id=${r.id ?? "?"})`);
  }
  return {
    id: String(r.id ?? ""),
    question: String(r.question ?? ""),
    source: String(r.source ?? ""),
    choices: [String(r.choice1 ?? ""), String(r.choice2 ?? ""), String(r.choice3 ?? ""), String(r.choice4 ?? "")],
    answer: ans,
  };
}

// =====================================================
// ✅HTMLエスケープ（健全版）
// =====================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 【...】 と 〖...〗 の中だけ黄色発光（span付与）
function highlightBrackets(str) {
  const safe = escapeHtml(str);
  return safe
    .replace(/【(.*?)】/g, '【<span class="hl">$1</span>】')
    .replace(/〖(.*?)〗/g, '〖<span class="hl">$1</span>〗');
}
// =====================================================

// ===== Card reward helpers =====
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rollCardByStars(stars) {
  if (stars < 3) return null;
  const tier = Math.min(5, Math.max(3, stars));
  const pool = CARD_POOL[tier] || [];
  if (!pool.length) return null;
  return { ...pickRandom(pool), rarity: tier };
}

function recordCard(card) {
  const counts = loadCardCounts();
  counts[card.id] = (counts[card.id] ?? 0) + 1;
  saveCardCounts(counts);
  return counts[card.id];
}

// CSSアニメ（.card-effect）を使う前提。存在しなくても落とさない。
function playCardEffect(rarity) {
  try {
    const el = document.createElement("div");
    el.className = `card-effect r${rarity}`;
    el.innerHTML = `<div class="card-effect-glow"></div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  } catch (_) {}
}

function updateScoreUI() {
  scoreEl.textContent = `Score: ${score}`;
}

function updateModeUI() {
  const label = mode === "endless" ? "連続学習" : "通常（10問）";
  modePillEl.textContent = label;
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
    // iOS/Chrome対策：無音再生→停止で解錠
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
    try {
      bgmAudio.pause();
    } catch (_) {}
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
  if (which === "correct") seCorrectPool.play();
  else seWrongPool.play();
}

// ===== Rendering / Session =====
function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();
  updateModeUI();
  updateMeterUI();

  const text = q.source ? `${q.question}（${q.source}）` : q.question;
  questionEl.innerHTML = highlightBrackets(text);

  sublineEl.textContent = "";

  choiceBtns.forEach((btn, i) => {
    btn.innerHTML = highlightBrackets(q.choices[i] || "---");
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

  const shuffled = shuffle([...pool]);

  // ✅通常・連続学習ともに「10問で一旦終了」（当初仕様）
  order = shuffled.slice(0, Math.min(TOTAL_QUESTIONS, shuffled.length));
  render();
}

function startNewSession() {
  startWithPool([...questions]);
}

function retryWrongOnlyOnce() {
  const wrong = history.filter((h) => !h.isCorrect).map((h) => h.q);
  if (!wrong.length) {
    startNewSession();
    return;
  }
  startWithPool(wrong);
}

// ===== Judge =====
function judge(selectedIdx) {
  if (locked) return;
  locked = true;
  disableChoices(true);

  const q = order[index];
  const correctIdx = q.answer - 1;
  const isCorrect = selectedIdx === correctIdx;

  // 履歴（復習用）
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

  // 自動遷移OFF：必ず「次へ」で進む
  nextBtn.disabled = false;
  pulseNext();
}

// ===== Result Overlay =====
let resultOverlay = null;

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
  const table = { 1: "見習い", 2: "一人前", 3: "職人", 4: "達人", 5: "神" };
  return table[s];
}

function buildReviewHtml() {
  const wrong = history.filter((h) => !h.isCorrect);

  if (!wrong.length) {
    return `
      <div class="review">
        <div style="opacity:.85;font-weight:800;margin-bottom:6px;">復習</div>
        <div style="opacity:.75;">全問正解。復習項目はありません。</div>
      </div>
    `;
  }

  const items = wrong
    .map((h, idx) => {
      const q = h.q;
      const qText = q.source ? `${q.question}（${q.source}）` : q.question;

      const choicesHtml = q.choices
        .map((c, i) => {
          const isC = i === h.correctIdx;
          const isS = i === h.selectedIdx;
          const cls = ["rv-choice", isC ? "is-correct" : "", isS ? "is-selected" : ""].filter(Boolean).join(" ");
          return `<div class="${cls}">${highlightBrackets(c)}</div>`;
        })
        .join("");

      return `
        <div class="rv-item">
          <div class="rv-q">#${idx + 1} ${highlightBrackets(qText)}</div>
          <div class="rv-choices">${choicesHtml}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="review">
      <div style="opacity:.85;font-weight:800;margin-bottom:6px;">復習（間違いのみ ${wrong.length} 件）</div>
      ${items}
    </div>
  `;
}

// =====================================================
// ✅結果オーバーレイ（ID付きDOMを生成）
// ※UIデザインは既存CSSに委ね、構造だけ健全化
// =====================================================
function ensureResultOverlay() {
  if (resultOverlay) return;

  resultOverlay = document.createElement("div");
  resultOverlay.className = "result-overlay";

  resultOverlay.innerHTML = `
    <div class="result-card">
      <div class="result-head">
        <div class="result-title" id="rankTitle">評価</div>
        <div class="result-rate" id="resultRate">--%</div>
      </div>

      <div class="stars" id="starsRow" aria-label="stars">
        <div class="star">★</div>
        <div class="star">★</div>
        <div class="star">★</div>
        <div class="star">★</div>
        <div class="star">★</div>
      </div>

      <div class="result-summary" id="resultSummary">---</div>
      <div class="result-details" id="resultDetails"></div>

      <div class="result-actions">
        <button class="ctrl" id="resultRestartBtn" type="button">もう一回</button>
        <button class="ctrl" id="resultRetryWrongBtn" type="button">間違い復習</button>
        <button class="ctrl" id="resultCollectionBtn" type="button">図鑑</button>
        <button class="ctrl" id="resultCloseBtn" type="button">閉じる</button>
      </div>

      <div id="resultReview"></div>
    </div>
  `;

  document.body.appendChild(resultOverlay);

  const rankTitleEl = resultOverlay.querySelector("#rankTitle");
  const rateEl = resultOverlay.querySelector("#resultRate");
  const resultSummaryEl = resultOverlay.querySelector("#resultSummary");
  const resultDetailsEl = resultOverlay.querySelector("#resultDetails");
  const starsRow = resultOverlay.querySelector("#starsRow");
  const reviewEl = resultOverlay.querySelector("#resultReview");

  const resultBtnRestartEl = resultOverlay.querySelector("#resultRestartBtn");
  const resultBtnRetryWrongEl = resultOverlay.querySelector("#resultRetryWrongBtn");
  const resultBtnCollectionEl = resultOverlay.querySelector("#resultCollectionBtn");
  const resultBtnCloseEl = resultOverlay.querySelector("#resultCloseBtn");

  function hide() {
    resultOverlay.classList.remove("show");
  }

  // 背景クリックで閉じる
  resultOverlay.addEventListener("click", (e) => {
    if (e.target === resultOverlay) hide();
  });

  // 閉じる
  if (resultBtnCloseEl) resultBtnCloseEl.addEventListener("click", hide);

  // もう一回
  if (resultBtnRestartEl) {
    resultBtnRestartEl.addEventListener("click", async () => {
      hide();
      await unlockAudioOnce();
      startNewSession();
    });
  }

  // 間違い復習
  if (resultBtnRetryWrongEl) {
    resultBtnRetryWrongEl.addEventListener("click", async () => {
      hide();
      await unlockAudioOnce();
      retryWrongOnlyOnce();
    });
  }

  // 図鑑
  if (resultBtnCollectionEl) {
    resultBtnCollectionEl.addEventListener("click", () => {
      window.location.href = "./collection.html";
    });
  }

  resultOverlay._set = ({ stars, rankName, percent, summary, details, reviewHtml, canRetryWrong }) => {
    if (resultBtnRetryWrongEl) {
      resultBtnRetryWrongEl.disabled = !canRetryWrong;
      resultBtnRetryWrongEl.style.opacity = canRetryWrong ? "" : "0.45";
    }

    if (rankTitleEl) rankTitleEl.textContent = `評価：${rankName}`;
    if (rateEl) rateEl.textContent = `${percent}%`;
    if (resultSummaryEl) resultSummaryEl.textContent = summary;
    if (resultDetailsEl) resultDetailsEl.innerHTML = details;
    if (reviewEl) reviewEl.innerHTML = reviewHtml;

    const starEls = starsRow ? Array.from(starsRow.querySelectorAll(".star")) : [];
    starEls.forEach((el) => el.classList.remove("on", "pop"));

    void resultOverlay.offsetWidth;
    resultOverlay.classList.add("show");

    for (let i = 0; i < Math.min(5, stars); i++) {
      setTimeout(() => {
        if (starEls[i]) {
          starEls[i].classList.add("on", "pop");
          setTimeout(() => starEls[i].classList.remove("pop"), 140);
        }
      }, 120 * i);
    }
  };
}
// =====================================================

function showResultOverlay() {
  ensureResultOverlay();

  const total = order.length || 1;
  const percent = Math.round((score / total) * 100);
  const stars = calcStars(score, total);
  const rank = calcRankName(stars, maxCombo);
  const message = getUserMessageByRate(percent);

  const canRetryWrong = history.some((h) => !h.isCorrect);
  const modeLabel = mode === "endless" ? "連続学習" : "通常";

  // ===== Card reward (normal only) =====
  let rewardHtml = "";
  if (mode === "normal") {
    const card = rollCardByStars(stars);
    if (card) {
      const n = recordCard(card);
      playCardEffect(card.rarity);

      const specialMsg =
        card.rarity === 5
          ? `<div class="card-meta" style="color:#ffe66b;font-weight:900;">
               ✨SSR！✨
             </div>`
          : "";

      // styles.css に .card-reward がある前提（無くても表示は文字列として成立）
      rewardHtml = `
        <div class="card-reward">
          <img src="${escapeHtml(card.img)}" alt="${escapeHtml(card.name)}">
          <div>
            <div class="card-name">獲得：${escapeHtml(card.name)}</div>
            <div class="card-meta">レアリティ：★${card.rarity} ／ 所持回数：${n}</div>
            ${specialMsg}
          </div>
        </div>
      `;
    }
  }
  // ================================

  const details = `
    <div style="display:grid;gap:6px;">
      <div><b>正解</b> ${score} / ${total}</div>
      <div><b>最大COMBO</b> x${maxCombo}</div>
      <div><b>モード</b> ${escapeHtml(modeLabel)}</div>
    </div>
    ${rewardHtml}
  `;

  const reviewHtml = mode === "endless" ? buildReviewHtml() : "";

  resultOverlay._set({
    stars,
    rankName: rank,
    percent,
    summary: message,
    details,
    reviewHtml,
    canRetryWrong: mode === "endless" ? canRetryWrong : false,
  });
}

function finish() {
  progressEl.textContent = "終了";
  disableChoices(true);
  nextBtn.disabled = true;

  // “結果表示”はオーバーレイに統一
  questionEl.textContent = `結果：${score} / ${order.length}`;
  sublineEl.textContent = "";
  statusEl.textContent = "おつかれさまでした。";

  showResultOverlay();
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
  index++;
  if (index >= order.length) {
    finish();
  } else {
    render();
  }
});

restartBtn.addEventListener("click", async () => {
  try {
    await unlockAudioOnce();
    startNewSession();
  } catch (e) {
    showError(e);
  }
});

bgmToggleBtn.addEventListener("click", async () => {
  await unlockAudioOnce();
  await setBgm(!bgmOn);
});

// Mode switch（開始画面）
function setMode(nextMode) {
  mode = nextMode;
  modeNormalBtn.classList.toggle("active", mode === "normal");
  modeEndlessBtn.classList.toggle("active", mode === "endless");
  updateModeUI();
}
modeNormalBtn.addEventListener("click", () => setMode("normal"));
modeEndlessBtn.addEventListener("click", () => setMode("endless"));

// ===== Start flow =====
async function beginFromStartScreen() {
  // 1) Audio unlock → 2) BGM ON → 3) セッション開始 → 4) 開始画面を消す
  await unlockAudioOnce();
  await setBgm(true);

  startNewSession();
  startScreenEl.style.display = "none";
}

startBtnEl.addEventListener("click", async () => {
  try {
    await beginFromStartScreen();
  } catch (e) {
    console.error(e);
    startNoteEl.textContent = `開始に失敗しました: ${e?.message ?? e}`;
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

  // start側も止める
  startBtnEl.disabled = true;
  startBtnEl.textContent = "読み込み失敗";
  startNoteEl.textContent = `詳細: ${err?.message ?? err}`;
}

// ===== Boot =====
(async function boot() {
  try {
    setMode("normal"); // 初期は通常

    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = "読み込み中…";
    startBtnEl.disabled = true;
    startBtnEl.textContent = "読み込み中…";

    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);

    // UIだけ準備（開始はStartボタンで）
    progressEl.textContent = `準備完了（問題数 ${questions.length}）`;
    updateScoreUI();
    updateModeUI();
    meterLabel.textContent = `進捗 0/0`;
    comboLabel.textContent = `最大COMBO x0`;
    meterInner.style.width = `0%`;
    questionEl.textContent = "スタートを押して開始してください。";
    sublineEl.textContent = "";
    statusEl.textContent = "";
    disableChoices(true);
    nextBtn.disabled = true;

    // Startを有効化
    startBtnEl.disabled = false;
    startBtnEl.textContent = "START";
    startNoteEl.textContent = "BGMはスタート時にONになります。";

    // 結果オーバーレイを事前生成（ラグ低減 / 起動時クラッシュ防止）
    ensureResultOverlay();
  } catch (e) {
    showError(e);
  }
})();
