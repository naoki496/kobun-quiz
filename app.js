// app.js (global)
const TOTAL_QUESTIONS = 10;

// ===== Timer settings =====
const QUESTION_TIME_SEC = 20; // 1問あたり
const WARN_AT_SEC = 5;        // 残り5秒で軽い発光（SE無し）

// ✅音声ファイル（root/assets/ 配下）
const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3",
  wrong: "./assets/wrong.mp3",
};

// ▼▼▼ A: cards.csv 受け皿（UI非変更） ▼▼▼
let cardsAll = [];
let cardPoolByRarity = { 3: [], 4: [], 5: [] };

function normalizeCardRow(r) {
  // cards.csv: id, rarity, name, img, wiki, weight
  const id = String(r.id ?? "").trim();
  const rarity = Number(r.rarity);
  const name = String(r.name ?? "").trim();
  const img = String(r.img ?? "").trim();
  const wiki = String(r.wiki ?? "").trim();
  const weightRaw = r.weight ?? "";
  const weight = Number(weightRaw) || 1;
  return { id, rarity, name, img, wiki, weight };
}

function rebuildCardPoolsFromCsv() {
  const next = { 3: [], 4: [], 5: [] };
  if (!Array.isArray(cardsAll)) cardsAll = [];
  for (const c of cardsAll) {
    if (!c || !c.id) continue;
    if (c.rarity === 3 || c.rarity === 4 || c.rarity === 5) next[c.rarity].push(c);
  }
  cardPoolByRarity = next;
}

function validateCardsCsv() {
  const errs = [];
  const warns = [];

  if (!Array.isArray(cardsAll) || cardsAll.length === 0) {
    warns.push("cards.csv: カードが0件です（カード抽選が発生しません）");
  }

  const seen = new Map();
  for (const c of cardsAll || []) {
    const key = c?.id;
    if (!key) {
      errs.push("cards.csv: id が空の行があります");
      continue;
    }
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [id, n] of seen.entries()) {
    if (n >= 2) errs.push(`cards.csv: id が重複しています: "${id}" x${n}`);
  }

  for (const c of cardsAll || []) {
    if (!c?.id) continue;
    if (!c.name) warns.push(`cards.csv: name が空です (id=${c.id})`);
    if (!c.img) errs.push(`cards.csv: img が空です (id=${c.id})`);
    if (!(c.rarity === 3 || c.rarity === 4 || c.rarity === 5)) {
      errs.push(`cards.csv: rarity が 3/4/5 ではありません (id=${c.id}, rarity=${c.rarity})`);
    }
    if (!Number.isFinite(Number(c.weight)) || Number(c.weight) <= 0) {
      warns.push(`cards.csv: weight が不正なので 1 扱いにします (id=${c.id}, weight=${c.weight})`);
    }
  }

  const s3 = (cardPoolByRarity[3] || []).length;
  const s4 = (cardPoolByRarity[4] || []).length;
  const s5 = (cardPoolByRarity[5] || []).length;

  if (errs.length) {
    console.groupCollapsed("%c[cards.csv] ERROR", "color:#ff6b6b;font-weight:900;");
    errs.forEach((m) => console.error(m));
    console.groupEnd();
  }
  if (warns.length) {
    console.groupCollapsed("%c[cards.csv] WARN", "color:#ffd54a;font-weight:900;");
    warns.forEach((m) => console.warn(m));
    console.groupEnd();
  }
  console.log(`[cards.csv] total=${(cardsAll || []).length} / ★3=${s3} ★4=${s4} ★5=${s5}`);

  return errs.length === 0;
}
// ▲▲▲ Aここまで ▲▲▲

let questions = [];
let order = [];
let index = 0;
let score = 0;
let locked = false;

// Combo
let combo = 0;
let maxCombo = 0;

// mode
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
const openCollectionBtn = document.getElementById("openCollectionBtn");

// ===== URL Params (mode/start) =====
const URLP = new URLSearchParams(location.search);
const URL_MODE = URLP.get("mode");               // "normal" | "endless" | null
const URL_AUTOSTART = URLP.get("start") === "1"; // true/false

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
        a.pause();
        a.currentTime = 0;
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
    isPersistent: ok,
    get(key) {
      if (ok) return window.localStorage.getItem(key);
      return mem.get(key) ?? null;
    },
    set(key, value) {
      try {
        if (ok) window.localStorage.setItem(key, value);
        else mem.set(key, value);
      } catch (e) {
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
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeAnswer(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[^\d]/g, "");
  return Number(s);
}

function normalizeRow(r) {
  const ans = normalizeAnswer(r.answer);
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
      String(r.choice4 ?? ""),
    ],
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
    .replace(/'/g, "&#39;");
}

function highlightBrackets(str) {
  const safe = escapeHtml(str);
  return safe.replace(/【(.*?)】/g, '【<span class="hl">$1</span>】');
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted(arr, getWeight) {
  if (!arr || !arr.length) return null;
  let total = 0;
  const ws = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let w = Number(getWeight(arr[i]));
    if (!Number.isFinite(w) || w <= 0) w = 1;
    ws[i] = w;
    total += w;
  }
  if (!Number.isFinite(total) || total <= 0) return pickRandom(arr);

  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= ws[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

// ===== Card reward helpers =====
function rollCardByStars(stars) {
  if (stars < 3) return null;
  const tier = Math.min(5, Math.max(3, stars));
  const csvPool = cardPoolByRarity?.[tier] || [];
  if (!csvPool.length) return null;

  const picked = pickWeighted(csvPool, (c) => c.weight ?? 1);
  if (!picked) return null;
  return { ...picked, rarity: tier };
}

function recordCard(card) {
  const counts = loadCardCounts();
  counts[card.id] = (counts[card.id] ?? 0) + 1;
  saveCardCounts(counts);
  return counts[card.id];
}

function playCardEffect(rarity) {
  try {
    const el = document.createElement("div");
    el.className = `card-effect r${rarity}`;
    el.innerHTML = `<div class="card-effect-glow"></div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), rarity === 5 ? 1550 : 1100);
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

function setStatusGlitchOnce() {
  if (!statusEl) return;
  statusEl.classList.remove("glitch");
  void statusEl.offsetWidth;
  statusEl.classList.add("glitch");
  setTimeout(() => statusEl.classList.remove("glitch"), 420);
}

function updateStatusUI(message, { glitch = false } = {}) {
  const comboText = combo >= 2 ? ` / COMBO x${combo}` : "";
  statusEl.textContent = `${message}${comboText}`;
  if (glitch) setStatusGlitchOnce();
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
  if (which === "correct") seCorrectPool.play();
  else seWrongPool.play();
}

// =====================================================
// ✅ TIMER UI (injected) / timer logic
// =====================================================
let timerOuterEl = null;
let timerInnerEl = null;
let timerTextEl = null;
let timerLoopId = null;
let timerEndAt = 0;
let timerTotalMs = QUESTION_TIME_SEC * 1000;

function ensureTimerUI() {
  if (timerOuterEl && timerInnerEl && timerTextEl) return;

  const meterArea = document.getElementById("meterArea");
  if (!meterArea) return;

  const wrap = document.createElement("div");
  wrap.className = "timer-wrap";
  wrap.innerHTML = `
    <div class="timer-head">
      <div class="timer-title">TIME</div>
      <div id="timerText" class="timer-text">--</div>
    </div>
    <div id="timerOuter" class="timer-outer"><div id="timerInner" class="timer-inner"></div></div>
  `;

  meterArea.appendChild(wrap);
  timerOuterEl = wrap.querySelector("#timerOuter");
  timerInnerEl = wrap.querySelector("#timerInner");
  timerTextEl = wrap.querySelector("#timerText");
}

function stopTimer() {
  if (timerLoopId) {
    clearInterval(timerLoopId);
    timerLoopId = null;
  }
  if (timerOuterEl) timerOuterEl.classList.remove("warn");
}

function setTimerBarStyleByRemain(remainMs) {
  if (!timerInnerEl) return;

  const frac = Math.max(0, Math.min(1, remainMs / timerTotalMs)); // 1 -> 0
  // 冷色(青) -> 白寄りへ
  // 残りが少ないほど whiten を増やす
  const whiten = Math.round((1 - frac) * 85); // 0..85
  const alphaA = 0.75 + (1 - frac) * 0.15;
  const alphaB = 0.35 + (1 - frac) * 0.20;

  const cA = `rgba(${Math.min(120 + whiten, 235)}, ${Math.min(220 + whiten, 255)}, 255, ${alphaA.toFixed(2)})`;
  const cB = `rgba(${Math.min(0 + whiten, 240)}, ${Math.min(180 + whiten, 255)}, ${Math.min(255, 255)}, ${alphaB.toFixed(2)})`;

  timerInnerEl.style.background = `linear-gradient(90deg, ${cA}, ${cB})`;
  timerInnerEl.style.boxShadow = `0 0 ${Math.round(18 + (1 - frac) * 16)}px rgba(170, 230, 255, ${Math.min(0.36, 0.20 + (1 - frac) * 0.22).toFixed(2)})`;
}

function startTimerForQuestion() {
  ensureTimerUI();
  stopTimer();

  timerTotalMs = QUESTION_TIME_SEC * 1000;
  timerEndAt = Date.now() + timerTotalMs;

  // 初期表示
  if (timerTextEl) timerTextEl.textContent = `${QUESTION_TIME_SEC.toFixed(0)}.0s`;
  if (timerInnerEl) timerInnerEl.style.width = "100%";
  setTimerBarStyleByRemain(timerTotalMs);

  // 100ms刻み（軽量）
  timerLoopId = setInterval(() => {
    const now = Date.now();
    const remain = timerEndAt - now;
  
    if (remain <= 0) {
      stopTimer();
      onTimeUp();
      return;
    }
  
    const sec = remain / 1000;
    if (timerTextEl) timerTextEl.textContent = `${sec.toFixed(1)}s`;
  
    const pct = Math.max(0, Math.min(100, (remain / timerTotalMs) * 100));
    if (timerInnerEl) timerInnerEl.style.width = `${pct}%`;
  
    // warn（残り5秒）
    const isWarn = sec <= WARN_AT_SEC;
    if (timerOuterEl) {
      if (isWarn) timerOuterEl.classList.add("warn");
      else timerOuterEl.classList.remove("warn");
    }
  
    // ✅ バー色：通常は青→白、残り5秒は「赤」に強制
    if (isWarn && timerInnerEl) {
      timerInnerEl.style.background =
        "linear-gradient(90deg, rgba(255,70,70,0.95), rgba(255,180,80,0.65))";
      timerInnerEl.style.boxShadow =
        "0 0 28px rgba(255,70,70,0.35), 0 0 60px rgba(255,70,70,0.16)";
    } else {
      setTimerBarStyleByRemain(remain); // 青→白
    }
  }, 100);
}

// TIME UP時のみ：淡いノイズ走査線（軽量）
function triggerTimeUpScanlineOnce() {
  if (!quizEl) return;
  quizEl.classList.remove("timeup-scan");
  void quizEl.offsetWidth;
  quizEl.classList.add("timeup-scan");
  setTimeout(() => quizEl.classList.remove("timeup-scan"), 900);
}

function onTimeUp() {
  if (locked) return;

  locked = true;
  disableChoices(true);

  const q = order[index];
  const correctIdx = q.answer - 1;

  // 正解だけ表示（不正解の赤は付けない）
  try {
    choiceBtns.forEach((btn) => btn.classList.remove("correct", "wrong"));
    if (choiceBtns[correctIdx]) choiceBtns[correctIdx].classList.add("correct");
  } catch (_) {}

  // コンボは途切れる扱い
  combo = 0;
  updateMeterUI();
  updateScoreUI();

  triggerTimeUpScanlineOnce();
  updateStatusUI("TIME UP", { glitch: true });

  // 「次へ」解禁
  nextBtn.disabled = false;
  pulseNext();
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

  // ✅各問の開始タイマー
  startTimerForQuestion();
}

function startWithPool(pool) {
  score = 0;
  index = 0;
  combo = 0;
  maxCombo = 0;
  history = [];

  if (!pool.length) throw new Error("問題が0件です（CSVの内容を確認してください）");
  const shuffled = shuffle([...pool]);

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

  // ✅回答が入ったらタイマー停止
  stopTimer();

  disableChoices(true);
  const q = order[index];
  const correctIdx = q.answer - 1;
  const isCorrect = selectedIdx === correctIdx;

  // 履歴
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

  nextBtn.disabled = false;
  pulseNext();
}

// ===== Result Overlay（元ロジック維持） =====
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
        <div class="rv-item">全問正解。復習項目はありません。</div>
      </div>
    `;
  }
  const items = wrong.map((h, idx) => {
    const q = h.q;
    const qText = q.source ? `${q.question}（${q.source}）` : q.question;
    const choicesHtml = q.choices
      .map((c, i) => {
        const isC = i === h.correctIdx;
        const isS = i === h.selectedIdx;
        const cls = ["rv-choice", isC ? "is-correct" : "", isS ? "is-selected" : ""]
          .filter(Boolean)
          .join(" ");
        return `<div class="${cls}">${highlightBrackets(c)}</div>`;
      })
      .join("");

    return `
      <div class="rv-item">
        <div class="rv-q">#${idx + 1} ${highlightBrackets(qText)}</div>
        <div class="rv-choices">${choicesHtml}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="review">
      <div style="opacity:.9;margin-bottom:6px;">復習（間違いのみ ${wrong.length} 件）</div>
      ${items}
    </div>
  `;
}

function ensureResultOverlay() {
  if (resultOverlay) return;

  resultOverlay = document.createElement("div");
  resultOverlay.className = "result-overlay";
  resultOverlay.innerHTML = `
    <div class="result-card" role="dialog" aria-modal="true">
      <div class="result-head">
        <div id="rankTitle" class="result-title">評価</div>
        <div id="resultRate" class="result-rate">--%</div>
      </div>

      <div id="starsRow" class="stars" aria-label="星評価">
        <div class="star">★</div>
        <div class="star">★</div>
        <div class="star">★</div>
        <div class="star">★</div>
        <div class="star">★</div>
      </div>

      <div id="resultSummary" class="result-summary">---</div>
      <div id="resultDetails" class="result-details">---</div>
      <div id="resultReview"></div>

      <div class="result-actions">
        <button id="resultRestartBtn" class="ctrl" type="button">もう一回</button>
        <button id="resultRetryWrongBtn" class="ctrl" type="button">間違い復習</button>
        <button id="resultCollectionBtn" class="ctrl" type="button">図鑑</button>
        <button id="resultCloseBtn" class="ctrl" type="button">閉じる</button>
      </div>
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

  resultOverlay.addEventListener("click", (e) => {
    if (e.target === resultOverlay) hide();
  });

  if (resultBtnCloseEl) resultBtnCloseEl.addEventListener("click", hide);

  if (resultBtnRestartEl) {
    resultBtnRestartEl.addEventListener("click", async () => {
      hide();
      await unlockAudioOnce();
      startNewSession();
    });
  }

  if (resultBtnRetryWrongEl) {
    resultBtnRetryWrongEl.addEventListener("click", async () => {
      hide();
      await unlockAudioOnce();
      retryWrongOnlyOnce();
    });
  }

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

function showResultOverlay() {
  ensureResultOverlay();

  const total = order.length || 1;
  const percent = Math.round((score / total) * 100);
  const stars = calcStars(score, total);
  const rank = calcRankName(stars, maxCombo);
  const message = getUserMessageByRate(percent);
  const canRetryWrong = history.some((h) => !h.isCorrect);
  const modeLabel = mode === "endless" ? "連続学習" : "通常";

  let rewardHtml = "";
  if (mode === "normal") {
    const card = rollCardByStars(stars);
    if (card) {
      const n = recordCard(card);
      playCardEffect(card.rarity);

      const specialMsg = card.rarity === 5 ? `<div style="margin-top:6px;">✨SSR！✨</div>` : "";

      rewardHtml = `
        <div class="card-reward">
          <img src="${escapeHtml(card.img)}" alt="${escapeHtml(card.name)}" />
          <div>
            <div class="card-name">獲得：${escapeHtml(card.name)}</div>
            <div class="card-meta">レアリティ：★${card.rarity} ／ 所持回数：${n}</div>
            ${specialMsg}
          </div>
        </div>
      `;
    }
  }

  const details = `
    <div>正解 ${score} / ${total}</div>
    <div>最大COMBO x${maxCombo}</div>
    <div>モード ${escapeHtml(modeLabel)}</div>
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
  stopTimer();

  progressEl.textContent = "終了";
  disableChoices(true);
  nextBtn.disabled = true;

  questionEl.textContent = `結果：${score} / ${order.length}`;
  sublineEl.textContent = "";
  statusEl.textContent = "おつかれさまでした。";

  showResultOverlay();
}

// ===== Events =====
choiceBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await unlockAudioOnce(); // ユーザー操作なのでOK
    const idx = Number(btn.dataset.idx);
    judge(idx);
  });
});

nextBtn.addEventListener("click", () => {
  // 次へ押下でタイマーは次のrenderで再開
  index++;
  if (index >= order.length) finish();
  else render();
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

// Start画面：図鑑を開く（保険）
if (openCollectionBtn) {
  openCollectionBtn.addEventListener("click", () => {
    window.location.href = "./collection.html";
  });
}

// Mode switch（開始画面）
function setMode(nextMode) {
  mode = nextMode;
  updateModeUI();
}

// ✅開始処理
async function beginFromStartScreen({ auto = false } = {}) {
  // auto start は「ユーザー操作」ではないので BGM自動ONしない
  if (!auto) {
    await unlockAudioOnce();
    await setBgm(true);
  }

  startNewSession();

  // “隠す” ではなく “消す”
  try {
    if (startScreenEl) startScreenEl.remove();
  } catch (_) {
    if (startScreenEl) startScreenEl.style.display = "none";
  }

  // URLから start=1 を消す（自動開始の再発防止）
  try {
    const p = new URLSearchParams(location.search);
    p.delete("start");
    const next = `${location.pathname}${p.toString() ? "?" + p.toString() : ""}`;
    history.replaceState(null, "", next);
  } catch (_) {}
}

function canBeginNow() {
  return startBtnEl && !startBtnEl.disabled;
}

if (modeNormalBtn) {
  modeNormalBtn.addEventListener("click", async (e) => {
    setMode("normal");
    if (canBeginNow()) {
      e.preventDefault();
      try { await beginFromStartScreen({ auto: false }); } catch (err) { console.error(err); }
    }
    // canBeginNow() が false の時は、aタグのhref遷移に任せる
  });
}

if (modeEndlessBtn) {
  modeEndlessBtn.addEventListener("click", async (e) => {
    setMode("endless");
    if (canBeginNow()) {
      e.preventDefault();
      try { await beginFromStartScreen({ auto: false }); } catch (err) { console.error(err); }
    }
  });
}

// 互換用：startBtn が存在する場合
if (startBtnEl) {
  startBtnEl.addEventListener("click", async () => {
    try {
      if (!canBeginNow()) return;
      await beginFromStartScreen({ auto: false });
    } catch (e) {
      console.error(e);
      if (startNoteEl) startNoteEl.textContent = `開始に失敗しました: ${e?.message ?? e}`;
    }
  });
}

// ===== Error =====
function showError(err) {
  console.error(err);
  stopTimer();

  progressEl.textContent = "読み込み失敗";
  scoreEl.textContent = "Score: 0";
  questionEl.textContent = "CSVを読み込めませんでした。";
  sublineEl.textContent = "";
  statusEl.textContent = `詳細: ${err?.message ?? err}`;
  disableChoices(true);
  nextBtn.disabled = true;

  if (startBtnEl) {
    startBtnEl.disabled = true;
    startBtnEl.textContent = "読み込み失敗";
  }
  if (startNoteEl) startNoteEl.textContent = `詳細: ${err?.message ?? err}`;
}

// ===== Boot =====
(async function boot() {
  try {
    // 初期モード：URL優先
    if (URL_MODE === "endless" || URL_MODE === "normal") setMode(URL_MODE);
    else setMode("normal");

    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = "読み込み中…";
    if (startBtnEl) {
      startBtnEl.disabled = true;
      startBtnEl.textContent = "読み込み中…";
    }

    // questions.csv
    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);

    // cards.csv（失敗しても落とさない）
    try {
      const cardsUrl = new URL("cards.csv", baseUrl).toString();
      const rawCards = await window.CSVUtil.load(cardsUrl);

      const nextCards = [];
      for (const r of rawCards) {
        try {
          const c = normalizeCardRow(r);
          if (c.id) nextCards.push(c);
          else console.warn("[cards.csv] skip: empty id row", r);
        } catch (e) {
          console.warn("[cards.csv] skip: normalize failed", e, r);
        }
      }

      cardsAll = nextCards;
      rebuildCardPoolsFromCsv();
      validateCardsCsv();
    } catch (e) {
      console.warn("[cards.csv] load/validate failed (fallback to empty).", e);
      cardsAll = [];
      cardPoolByRarity = { 3: [], 4: [], 5: [] };
    }

    // UIだけ準備
    progressEl.textContent = `準備完了（問題数 ${questions.length}）`;
    updateScoreUI();
    updateModeUI();
    meterLabel.textContent = `進捗 0/0`;
    comboLabel.textContent = `最大COMBO x0`;
    meterInner.style.width = `0%`;

    questionEl.textContent = "始めたいメニューを選んでください。";
    sublineEl.textContent = "";
    statusEl.textContent = "";

    disableChoices(true);
    nextBtn.disabled = true;

    // timer UI だけ先に出しておく
    ensureTimerUI();
    if (timerTextEl) timerTextEl.textContent = `${QUESTION_TIME_SEC.toFixed(0)}.0s`;
    if (timerInnerEl) {
      timerInnerEl.style.width = "100%";
      setTimerBarStyleByRemain(QUESTION_TIME_SEC * 1000);
    }

    if (startBtnEl) {
      startBtnEl.disabled = false;
      startBtnEl.textContent = "START";
    }
    if (startNoteEl) {
      startNoteEl.textContent = "BGMは開始後にONにできます。";
    }

    ensureResultOverlay();

    // ✅ start=1 が付いていたら「自動開始」するが、BGMは自動ONしない（NotAllowedError回避）
    if (URL_AUTOSTART) {
      try {
        await beginFromStartScreen({ auto: true });
      } catch (e) {
        console.warn("auto start failed:", e);
      }
    }
  } catch (e) {
    showError(e);
  }
})();
