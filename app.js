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
const URL_MODE = URLP.get("mode");          // "normal" | "endless" | null
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
const STORAGE_KEY_CARD_COUNTS = "hklobby.v1.cardCounts";

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

function migrateCardCountsOnce() {
  try {
    const NEW_KEY = "hklobby.v1.cardCounts";
    const OLD_KEY = "kobunQuiz.v1.cardCounts";
    const hasNew = !!window.localStorage.getItem(NEW_KEY);
    if (hasNew) return;

    const oldVal = window.localStorage.getItem(OLD_KEY);
    if (oldVal && oldVal.trim()) {
      window.localStorage.setItem(NEW_KEY, oldVal);
      console.log(`[migrate] ${OLD_KEY} -> ${NEW_KEY}`);
    }
  } catch (e) {
    console.warn("[migrate] failed", e);
  }
}

// boot時に1回呼ぶ（cards.csv読み込み前後どちらでもOK）
migrateCardCountsOnce();

// ===== Utils =====

// ===== Countdown Overlay =====
let countdownOverlayEl = null;

function ensureCountdownOverlay() {
  if (countdownOverlayEl) return countdownOverlayEl;

  const el = document.createElement("div");
  el.id = "countdownOverlay";
  el.innerHTML = `<div class="countdown-num" id="countdownNum">3</div>`;
  el.style.display = "none";
  document.body.appendChild(el);
  countdownOverlayEl = el;
  return el;
}

async function runCountdown() {
  const overlay = ensureCountdownOverlay();
  const numEl = overlay.querySelector("#countdownNum");

  overlay.style.display = "flex";

  const seq = ["3", "2", "1", "GO"];
  for (let i = 0; i < seq.length; i++) {
    numEl.textContent = seq[i];
    numEl.classList.remove("pop");
    // reflowでアニメを確実に再実行
    void numEl.offsetWidth;
    numEl.classList.add("pop");
    await new Promise((r) => setTimeout(r, 850)); // 体感良いテンポ
  }

  overlay.style.display = "none";
}

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

// ✅〖〗が正。互換として【】もハイライト（表示括弧は維持）
function highlightBrackets(str) {
  const safe = escapeHtml(str);

  // 正式：〖...〗
  const a = safe.replace(/〖(.*?)〗/g, '〖<span class="hl">$1</span>〗');

  // 互換：【...】（古いデータ混在保険）
  return a.replace(/【(.*?)】/g, '【<span class="hl">$1</span>】');
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

  // 評価★ごとの排出確率テーブル
  // ※ 合計は 1.0
  const DROP_TABLE = {
    3: [
      { tier: 3, p: 0.85 },
      { tier: 4, p: 0.15 },
    ],
    4: [
      { tier: 3, p: 0.60 },
      { tier: 4, p: 0.30 },
      { tier: 5, p: 0.10 },
    ],
    5: [
      { tier: 3, p: 0.45 },
      { tier: 4, p: 0.35 },
      { tier: 5, p: 0.20 },
    ],
  };

  const table = DROP_TABLE[Math.min(5, stars)];
  if (!table) return null;

  // tier抽選
  let r = Math.random();
  let tier = null;
  for (const row of table) {
    r -= row.p;
    if (r <= 0) {
      tier = row.tier;
      break;
    }
  }
  if (!tier) tier = table[table.length - 1].tier;

  // CSVプールから抽選
  const pool = cardPoolByRarity?.[tier] || [];
  if (!pool.length) return null;

  const picked = pickWeighted(pool, (c) => c.weight ?? 1);
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
    el.innerHTML = `
      <div class="ce-ring"></div>
      <div class="ce-burst"></div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), rarity === 5 ? 1550 : 1100);
  } catch (_) {}
}

function updateScoreUI() {
  scoreEl.textContent = `Score: ${score}`;
}

function updateModeUI() {
  const label = mode === "endless" ? "連続学習" : "通常（10問）";
  if (modePillEl) modePillEl.textContent = label;
}

function updateMeterUI() {
  const total = order.length || 1;
  const cur = Math.min(index + 1, total);
  const percent = Math.round((cur / total) * 100);

  if (meterLabel) meterLabel.textContent = `進捗 ${cur}/${total} (${percent}%)`;
  if (comboLabel) comboLabel.textContent = `最大COMBO x${maxCombo}`;
  if (meterInner) meterInner.style.width = `${percent}%`;
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
  if (statusEl) statusEl.textContent = `${message}${comboText}`;
  if (glitch) setStatusGlitchOnce();
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
    <div class="timer-outer" id="timerOuter">
      <div class="timer-inner" id="timerInner"></div>
    </div>
    <div class="timer-text" id="timerText">TIME<br>--</div>
  `;
  meterArea.appendChild(wrap);

  timerOuterEl = wrap.querySelector("#timerOuter");
  timerInnerEl = wrap.querySelector("#timerInner");
  timerTextEl = wrap.querySelector("#timerText");
}

function stopTimer() {
  if (timerLoopId) {
    cancelAnimationFrame(timerLoopId);
    timerLoopId = null;
  }
  if (timerOuterEl) timerOuterEl.classList.remove("warn");
}

function startTimer(onTimeUp) {
  ensureTimerUI();
  stopTimer();

  const now = performance.now();
  timerTotalMs = QUESTION_TIME_SEC * 1000;
  timerEndAt = now + timerTotalMs;

  function tick() {
    const t = performance.now();
    const leftMs = Math.max(0, timerEndAt - t);
    const leftSec = Math.ceil(leftMs / 1000);

    const ratio = Math.max(0, Math.min(1, leftMs / timerTotalMs));
    if (timerInnerEl) timerInnerEl.style.width = `${Math.round(ratio * 100)}%`;

    if (timerTextEl) timerTextEl.innerHTML = `TIME<br>${leftSec}`;

    if (timerOuterEl) {
      const warn = leftSec <= WARN_AT_SEC;
      timerOuterEl.classList.toggle("warn", warn);
    }

    if (leftMs <= 0) {
      stopTimer();
      onTimeUp?.();
      return;
    }
    timerLoopId = requestAnimationFrame(tick);
  }

  timerLoopId = requestAnimationFrame(tick);
}

// =====================================================
// ✅ Mode selection
// =====================================================
function setMode(next) {
  mode = next === "endless" ? "endless" : "normal";
  updateModeUI();
  if (startNoteEl) {
    startNoteEl.textContent = mode === "endless"
      ? "連続学習：止めるまで続きます（10問表示はしません）"
      : "通常：10問で結果が出ます";
  }
}

// =====================================================
// ✅ Start screen / begin
// =====================================================
function canBeginNow() {
  // 問題CSVがまだなら開始不可
  return Array.isArray(questions) && questions.length > 0;
}

async function beginFromStartScreen({ auto = false } = {}) {
  // auto start は「ユーザー操作」ではないので BGM自動ONしない
  if (!auto) {
    await unlockAudioOnce();
    await setBgm(true);
  }

  // “隠す” ではなく “消す”
  try {
    if (startScreenEl) startScreenEl.remove();
  } catch (_) {
    if (startScreenEl) startScreenEl.style.display = "none";
  }

  // ★ここでカウントダウン
  await runCountdown();

  // ★カウント後に開始
  startNewSession();

  // URLから start=1 を消す（自動開始の再発防止）
  try {
    const p = new URLSearchParams(location.search);
    p.delete("start");
    const next = `${location.pathname}${p.toString() ? "?" + p.toString() : ""}`;
    history.replaceState(null, "", next);
  } catch (_) {}
}

// =====================================================
// ✅ Quiz core
// =====================================================
function setQuestion(i) {
  index = i;
  locked = false;

  const q = questions[order[index]];
  if (!q) return;

  progressEl.textContent = mode === "endless"
    ? `Q.${index + 1}`
    : `Q.${index + 1}/${order.length}`;

  questionEl.innerHTML = highlightBrackets(q.question);

  sublineEl.textContent = q.source ? `出典：${q.source}` : "";

  choiceBtns.forEach((btn, idx) => {
    btn.disabled = false;
    btn.classList.remove("correct", "wrong");
    btn.innerHTML = escapeHtml(q.choices[idx] ?? "");
  });

  nextBtn.disabled = true;
  updateMeterUI();
  updateStatusUI("選択してください");

  // タイマー開始（時間切れで誤答扱い）
  startTimer(() => {
    if (locked) return;
    locked = true;

    combo = 0;
    updateStatusUI("TIME UP", { glitch: true });
    shakeBad();
    playSE("wrong");

    history.push({
      ...q,
      picked: 0,
      correct: false,
      reason: "timeup",
    });

    nextBtn.disabled = false;
    pulseNext();
  });
}

function judge(pick) {
  if (locked) return;
  locked = true;
  stopTimer();

  const q = questions[order[index]];
  if (!q) return;

  const correct = pick === q.answer;

  // UI mark
  choiceBtns.forEach((btn, idx) => {
    const n = idx + 1;
    if (n === q.answer) btn.classList.add("correct");
    if (n === pick && !correct) btn.classList.add("wrong");
    btn.disabled = true;
  });

  // status / score / combo
  if (correct) {
    score += 10;
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    updateStatusUI("CORRECT", { glitch: true });
    flashGood();
    playSE("correct");
  } else {
    combo = 0;
    updateStatusUI("WRONG", { glitch: true });
    shakeBad();
    playSE("wrong");
  }
  updateScoreUI();
  updateMeterUI();

  // history
  history.push({
    ...q,
    picked: pick,
    correct,
    reason: "answer",
  });

  // card reward (★ by performance)
  try {
    const stars = correct ? (combo >= 8 ? 5 : combo >= 4 ? 4 : 3) : 0;
    const card = rollCardByStars(stars);
    if (card) {
      const n = recordCard(card);
      playCardEffect(card.rarity);
      updateStatusUI(`GET: ★${card.rarity} ${card.name} (x${n})`, { glitch: true });
    }
  } catch (_) {}

  nextBtn.disabled = false;
  pulseNext();
}

function next() {
  if (mode === "endless") {
    // endless: 次の1問を追加抽選
    if (questions.length === 0) return;
    order.push(Math.floor(Math.random() * questions.length));
    setQuestion(index + 1);
    return;
  }

  // normal
  if (index + 1 >= order.length) {
    showResult();
  } else {
    setQuestion(index + 1);
  }
}

function startNewSession() {
  score = 0;
  combo = 0;
  maxCombo = 0;
  history = [];

  updateScoreUI();

  if (mode === "endless") {
    order = [Math.floor(Math.random() * questions.length)];
  } else {
    order = shuffle([...Array(questions.length).keys()]).slice(0, TOTAL_QUESTIONS);
  }

  setQuestion(0);
}

// =====================================================
// ✅ Result / Review
// =====================================================
function showResult() {
  stopTimer();
  disableChoices(true);
  nextBtn.disabled = true;

  const total = order.length || 1;
  const max = total * 10;

  questionEl.innerHTML = `RESULT`;
  sublineEl.textContent = "";
  progressEl.textContent = "";

  const rate = Math.round((score / max) * 100);
  statusEl.textContent = `Score ${score}/${max} (${rate}%) / MAX COMBO x${maxCombo}`;

  // choices are used as result buttons
  const labels = [
    "復習を見る",
    "もう一度（同モード）",
    "図鑑を見る",
    "TOPへ戻る",
  ];

  choiceBtns.forEach((btn, idx) => {
    btn.disabled = false;
    btn.classList.remove("correct", "wrong");
    btn.textContent = labels[idx];
    btn.onclick = null;
  });

  choiceBtns[0].onclick = () => openReview();
  choiceBtns[1].onclick = () => {
    startNewSession();
  };
  choiceBtns[2].onclick = () => openCollection();
  choiceBtns[3].onclick = () => location.href = "./index.html";
}

function openReview() {
  stopTimer();
  questionEl.innerHTML = "復習";
  sublineEl.textContent = "誤答・時間切れを中心に表示します";
  progressEl.textContent = "";

  const wrongs = history.filter((h) => !h.correct);
  if (!wrongs.length) {
    statusEl.textContent = "全問正解（または誤答なし）です。";
  } else {
    statusEl.textContent = `誤答/時間切れ: ${wrongs.length}件`;
  }

  const list = wrongs.length ? wrongs : history.slice(-Math.min(10, history.length));

  const q = list[0];
  questionEl.innerHTML = highlightBrackets(q.question);
  sublineEl.textContent = q.source ? `出典：${q.source}` : "";

  choiceBtns.forEach((btn, idx) => {
    const n = idx + 1;
    btn.disabled = true;
    btn.classList.remove("correct", "wrong");
    btn.innerHTML = escapeHtml(q.choices[idx] ?? "");

    if (n === q.answer) btn.classList.add("correct");
    if (n === q.picked && !q.correct) btn.classList.add("wrong");
  });

  nextBtn.disabled = true;
}

function openCollection() {
  location.href = "./collection.html";
}

// =====================================================
// ✅ CSV load (questions + cards)
// =====================================================
async function loadAllCsv() {
  // questions.csv
  const qrows = await csvFetch("./questions.csv");
  questions = qrows.map(normalizeRow);

  // cards.csv
  try {
    const crows = await csvFetch("./cards.csv");
    cardsAll = crows.map(normalizeCardRow);
    rebuildCardPoolsFromCsv();
    validateCardsCsv();
  } catch (e) {
    console.warn("[cards.csv] load failed", e);
    cardsAll = [];
    cardPoolByRarity = { 3: [], 4: [], 5: [] };
  }
}

// =====================================================
// ✅ Bindings
// =====================================================
choiceBtns.forEach((btn, i) => {
  btn.addEventListener("click", () => judge(i + 1));
});

nextBtn.addEventListener("click", next);

if (restartBtn) {
  restartBtn.addEventListener("click", () => location.reload());
}

if (bgmToggleBtn) {
  bgmToggleBtn.addEventListener("click", async () => {
    await unlockAudioOnce();
    await setBgm(!bgmOn);
  });
}

if (modeNormalBtn) {
  modeNormalBtn.addEventListener("click", async (e) => {
    setMode("normal");
    if (!canBeginNow()) return;
    e.preventDefault();
    await beginFromStartScreen({ auto: false });
  });
}
if (modeEndlessBtn) {
  modeEndlessBtn.addEventListener("click", async (e) => {
    setMode("endless");
    if (!canBeginNow()) return;
    e.preventDefault();
    await beginFromStartScreen({ auto: false });
  });
}

if (startBtnEl) {
  startBtnEl.addEventListener("click", async () => {
    if (!canBeginNow()) return;
    await beginFromStartScreen({ auto: false });
  });
}

if (openCollectionBtn) {
  openCollectionBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openCollection();
  });
}

// =====================================================
// ✅ boot
// =====================================================
(async function boot() {
  try {
    if (URL_MODE) setMode(URL_MODE);

    await loadAllCsv();

    if (!canBeginNow()) {
      if (statusEl) statusEl.textContent = "CSV読み込みに失敗しました。";
      return;
    }

    // URL自動開始
    if (URL_AUTOSTART) {
      await beginFromStartScreen({ auto: true });
    } else {
      updateModeUI();
      if (statusEl) statusEl.textContent = "モードを選んで開始してください";
    }
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.textContent = "初期化に失敗しました。";
  }
})();
