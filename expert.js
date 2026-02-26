/* expert.js (kobun-quiz EXPERT)
 * - START modal gating (audio unlock)
 * - BGM toggle (UI default ON; playback starts after START)
 * - 30 questions, 10 sec each, timeout=wrong, combo breaks
 * - Reward: ★5 (>=25 & maxCombo>=5), ★4 (20..24), else none
 * - localStorage: hklobby.v1.cardCounts
 */
(() => {
  "use strict";
// ===== EXPERT: time-limited debug bypass (no UI changes) =====
// Usage: open expert page with ?debug=1, then for 10 minutes HKP check/spend is bypassed (ledger untouched).
const EXPERT_DEBUG_PARAM_KEY = "debug";
const EXPERT_DEBUG_UNTIL_KEY = "hklobby.v1.expertDebugUntil";
const EXPERT_DEBUG_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

(function setupExpertDebugWindow(){
  try{
    const params = new URLSearchParams(location.search);
    if (params.get(EXPERT_DEBUG_PARAM_KEY) === "1") {
      localStorage.setItem(EXPERT_DEBUG_UNTIL_KEY, String(Date.now() + EXPERT_DEBUG_WINDOW_MS));
    }
  }catch{}
})();

function isExpertDebugActive(){
  try{
    const until = Number(localStorage.getItem(EXPERT_DEBUG_UNTIL_KEY) || "0");
    return Number.isFinite(until) && Date.now() < until;
  }catch{
    return false;
  }
}
// ===== /EXPERT debug bypass =====

  const TOTAL_QUESTIONS = 30;
  const QUESTION_TIME_SEC = 10;
  const WARN_AT_SEC = 3;

  const LS_KEY = "hklobby.v1.cardCounts";


  // =========================
  // HKP (shared) + runId ledger (anti double spend/award)
  // =========================
  const HKP_KEY = "hklobby.v1.hkp";
  const RUNID_KEY = "hklobby.v1.runId";
  const LEDGER_KEY = "hklobby.v1.ledger";

  const HKP_COST_EXPERT = 3;

  function getHKP() {
    const n = Number(localStorage.getItem(HKP_KEY));
    return Number.isFinite(n) ? (n | 0) : 0;
  }
  function setHKP(v) {
    localStorage.setItem(HKP_KEY, String((Number(v) | 0)));
  }
  function addHKP(delta) {
    const cur = getHKP();
    const next = (cur + (Number(delta) | 0)) | 0;
    setHKP(next);
    return next;
  }

  function loadLedger() {
    try {
      const raw = localStorage.getItem(LEDGER_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }
  function saveLedger(obj) {
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(obj || {})); } catch {}
  }
  function isProcessed(key) {
    const led = loadLedger();
    return !!led[key];
  }
  function markProcessed(key) {
    const led = loadLedger();
    led[key] = true;
    saveLedger(led);
  }

  function newRunId() {
    // time-based + random (good enough for local anti-double)
    return `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function setRunId(id) {
    localStorage.setItem(RUNID_KEY, String(id || ""));
  }

  const AUDIO = {
    bgm: new Audio("./assets/bgmex.mp3"),
    correct: new Audio("./assets/correct.mp3"),
    wrong: new Audio("./assets/wrongex.mp3"),
    go: new Audio("./assets/goex.mp3"),
    tick: new Audio("./assets/tick.mp3"),
    timeup: new Audio("./assets/wrongex.mp3"),
  };
  AUDIO.bgm.loop = true;
  AUDIO.bgm.volume = 0.65;

  const $id = (id) => document.getElementById(id);
  const requireEl = (id) => {
    const el = $id(id);
    if (!el) throw new Error(`Element not found: #${id}`);
    return el;
  };

  const wrap = requireEl("app");

  const hudQ = requireEl("hudQ");
  const hudCorrect = requireEl("hudCorrect");
  const hudCombo = requireEl("hudCombo");
  const hudMaxCombo = requireEl("hudMaxCombo");

  const meterArea = requireEl("meterArea");
  const sourceEl = requireEl("source");
  const questionEl = requireEl("question");
  const choicesEl = requireEl("choices");

  const btnRetry = requireEl("btnRetry");
  const btnBgm = requireEl("btnBgm");
  const noteEl = requireEl("note");

  const overlay = requireEl("overlay");
  const rCorrect = requireEl("rCorrect");
  const rMaxCombo = requireEl("rMaxCombo");
  const rReward = requireEl("rReward");
  const resultTitle = requireEl("resultTitle");
  const btnAgain = requireEl("btnAgain");

  const cardArea = requireEl("cardArea");
  const cardImg = requireEl("cardImg");
  const cardName = requireEl("cardName");
  const cardWiki = requireEl("cardWiki");

  const countdownEl = requireEl("countdown");

  const startOverlay = requireEl("startOverlay");
  const startCard = requireEl("startCard");
  const btnStart = requireEl("btnStart");

  // ===== Meter DOM =====
  const meterOuter = document.createElement("div");
  meterOuter.className = "meterOuter";
  const meterInner = document.createElement("div");
  meterInner.className = "meterInner";
  meterOuter.appendChild(meterInner);

  const meterText = document.createElement("div");
  meterText.className = "meterText";
  meterText.textContent = `${QUESTION_TIME_SEC}s`;

  meterArea.appendChild(meterOuter);
  meterArea.appendChild(meterText);

  // ===== Canvas FX (behind content) =====
  const panel = document.querySelector(".panel");
  const fxCanvas = document.createElement("canvas");
  fxCanvas.style.position = "absolute";
  fxCanvas.style.inset = "0";
  fxCanvas.style.width = "100%";
  fxCanvas.style.height = "100%";
  fxCanvas.style.pointerEvents = "none";
  fxCanvas.style.zIndex = "0"; // behind UI
  panel.appendChild(fxCanvas);

  const ctx = fxCanvas.getContext("2d", { alpha: true });

  function resizeCanvas() {
    const r = panel.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    fxCanvas.width = Math.max(1, Math.floor(r.width * dpr));
    fxCanvas.height = Math.max(1, Math.floor(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  resizeCanvas();

  let fxT = 0;

  function drawAlarmScan(mode = "warn") {
    const w = fxCanvas.width;
    const h = fxCanvas.height;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";

    // ✅ 常時走査線は出さない（warn時はスイープのみ）
    // exit時だけ走査線を足して「警報感」を強くする
    if (mode === "exit") {
      const step = 7;
      ctx.fillStyle = "rgba(255,45,85,0.06)";
      for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, 2);
    }

    // sweep band（上→下）
    const bandH = mode === "exit" ? 170 : 135;
    const speed = mode === "exit" ? 11 : 8;
    const bandY = (fxT * speed) % (h + bandH) - bandH;

    const grad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
    grad.addColorStop(0, "rgba(255,45,85,0)");
    grad.addColorStop(0.45, mode === "exit" ? "rgba(255,45,85,0.18)" : "rgba(255,45,85,0.12)");
    grad.addColorStop(0.55, mode === "exit" ? "rgba(255,45,85,0.18)" : "rgba(255,45,85,0.12)");
    grad.addColorStop(1, "rgba(255,45,85,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, bandY, w, bandH);

    // noise blocks
    const n = mode === "exit" ? 90 : 45;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const rw = 10 + Math.random() * (mode === "exit" ? 40 : 22);
      const rh = 1 + Math.random() * (mode === "exit" ? 5 : 3);
      ctx.fillStyle = `rgba(255,45,85,${mode === "exit" ? 0.04 : 0.028})`;
      ctx.fillRect(x, y, rw, rh);
    }

    ctx.restore();
  }

  function fxTick() {
    fxT += 1;

    // destination-out fade (prevents dark accumulation)
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
    ctx.restore();

    if (state.started && state.tLeft <= WARN_AT_SEC && !state.finished) {
      drawAlarmScan("warn");
    }
    requestAnimationFrame(fxTick);
  }
  requestAnimationFrame(fxTick);

  // ===== State =====
  const state = {
    started: false,
    finished: false,

    runId: "",
    hkpSpentCost: 0,

    questions: [],
    picks: [],
    idx: 0,

    correct: 0,
    combo: 0,
    maxCombo: 0,

    tLeft: QUESTION_TIME_SEC,
    timerId: null,
    lastWholeSec: QUESTION_TIME_SEC,

    bgmOn: true,      // UI default ON
    bgmArmed: false,  // becomes true after START gesture
    warnOn: false,

    cards: [],
  };

  // ===== Utils =====
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderHighlighted(text) {
    const s = String(text ?? "");
    return esc(s).replace(/【(.*?)】/g, (_m, p1) => `<span class="hl">【${esc(p1)}】</span>`);
  }

  function playOne(audio, { volume, restart = true } = {}) {
    if (!audio) return;
    try {
      if (typeof volume === "number") audio.volume = volume;
      if (restart) audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {}
  }

  function setWrapFx(cls, dur = 360) {
    wrap.classList.add(cls);
    window.setTimeout(() => wrap.classList.remove(cls), dur);
  }

  function punch(el) {
    el.classList.remove("punch");
    void el.offsetWidth;
    el.classList.add("punch");
  }

  // ===== localStorage =====
  function loadCounts() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function saveCounts(counts) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(counts)); } catch {}
  }
  function addCardToCounts(cardId) {
    const counts = loadCounts();
    const key = String(cardId);
    counts[key] = (counts[key] ?? 0) + 1;
    saveCounts(counts);
  }

  // ===== BGM =====
  function updateBgmUI() {
    btnBgm.setAttribute("aria-pressed", state.bgmOn ? "true" : "false");
    const label = state.bgmOn ? "BGM: ON" : "BGM: OFF";
    const span = btnBgm.querySelector(".bgmText");
    if (span) span.textContent = label;
    else btnBgm.textContent = label;
    noteEl.textContent = state.bgmOn ? "音：ON（STARTで再生開始）" : "音：OFF";
  }

  function setBgm(on) {
    state.bgmOn = !!on;
    updateBgmUI();

    // START前は鳴らさない（自動再生制限回避）
    if (!state.bgmArmed) return;

    if (state.bgmOn) playOne(AUDIO.bgm, { restart: false });
    else { try { AUDIO.bgm.pause(); } catch {} }
  }

  btnBgm.addEventListener("click", () => setBgm(!state.bgmOn));

  // ===== Countdown (mask fixed; animate only text) =====
  async function runCountdown() {
    countdownEl.classList.remove("hidden");

    let cdText = countdownEl.querySelector(".cdText");
    if (!cdText) {
      cdText = document.createElement("div");
      cdText.className = "cdText";
      countdownEl.textContent = "";
      countdownEl.appendChild(cdText);
    }

    const seq = ["3", "2", "1", "GO"];
    const STEP_MS = 700;
    const GO_MS = 820;

    for (const s of seq) {
      cdText.textContent = s;
      cdText.classList.remove("pop");
      void cdText.offsetWidth;
      cdText.classList.add("pop");

      if (s === "GO") playOne(AUDIO.go, { volume: 0.9 });
      await new Promise((r) => setTimeout(r, s === "GO" ? GO_MS : STEP_MS));
    }

    countdownEl.classList.add("hidden");
    cdText.textContent = "";
  }

  function hideStartOverlayWithFX() {
    startOverlay.classList.add("leaving");
    startCard.classList.add("leaving");
    drawAlarmScan("exit");
    window.setTimeout(() => startOverlay.classList.add("hidden"), 420);
  }

  async function startGameFromOverlay() {
    if (state.started) return;

    // ===== HKP spend (EXPERT entrance fee) =====
    const runId = newRunId();
    state.runId = runId;
    setRunId(runId);

    const spendKey = `spend${HKP_COST_EXPERT}:${runId}`;
    if (!isProcessed(spendKey)) {
      const cur = getHKP();
      if (!isExpertDebugActive() && cur < HKP_COST_EXPERT) {
        // No UI layout changes: use a simple alert.
        window.alert(`HKPが不足しています（必要: ${HKP_COST_EXPERT} / 現在: ${cur}）`);
        return;
      }
      if (!isExpertDebugActive()) {
        addHKP(-HKP_COST_EXPERT);
        markProcessed(spendKey);
        state.hkpSpentCost = HKP_COST_EXPERT;
      }
    } else {
      // Already processed for this runId (should not happen because runId is new), keep safe.
      state.hkpSpentCost = 0;
    }

    state.bgmArmed = true; // unlock audio by gesture
    hideStartOverlayWithFX();

    if (state.bgmOn) playOne(AUDIO.bgm, { restart: false });

    await runCountdown();
    bootRun();
  }

  btnStart.addEventListener("click", startGameFromOverlay);

  // ===== Data load =====
  async function loadAll() {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil.load が見つかりません（expert.html の script 順序：csv.js → expert.js）");
    }

    const qRows = await window.CSVUtil.load("./questions.csv");
    const cRows = await window.CSVUtil.load("./cards.csv");

    const questions = qRows
      .map(normalizeQuestionRow)
      .filter((q) => q && q.id && q.question && q.answer >= 1 && q.answer <= 4);

    const cards = cRows
      .map(normalizeCardRow)
      .filter((c) => c && c.id && (c.rarity === 4 || c.rarity === 5));

    state.questions = questions;
    state.cards = cards;
    state.picks = shuffle(questions).slice(0, TOTAL_QUESTIONS);
  }

  function normalizeQuestionRow(r) {
    const id = String(r.id ?? "").trim();
    const question = String(r.question ?? "").trim();
    const source = String(r.source ?? "").trim();

    const c1 = String(r.choice1 ?? "").trim();
    const c2 = String(r.choice2 ?? "").trim();
    const c3 = String(r.choice3 ?? "").trim();
    const c4 = String(r.choice4 ?? "").trim();

    const ans = Number(String(r.answer ?? "").trim());
    return { id, question, source, choices: [c1, c2, c3, c4], answer: ans };
  }

  function normalizeCardRow(r) {
    const id = String(r.id ?? "").trim();
    const rarity = Number(r.rarity) || 0;
    const name = String(r.name ?? "").trim();
    const img = String(r.img ?? "").trim();
    const wiki = String(r.wiki ?? "").trim();
    return { id, rarity, name, img, wiki };
  }

  // ===== HUD / timer =====
  function renderHUD() {
    hudQ.textContent = `${Math.min(state.idx + 1, TOTAL_QUESTIONS)}/${TOTAL_QUESTIONS}`;
    hudCorrect.textContent = String(state.correct);
    hudCombo.textContent = String(state.combo);
    hudMaxCombo.textContent = String(state.maxCombo);
  }

  function setWarn(on) {
    const yes = !!on;
    if (state.warnOn === yes) return;
    state.warnOn = yes;
    if (yes) wrap.classList.add("fx-warn");
    else wrap.classList.remove("fx-warn");
  }

  function updateMeter() {
    const ratio = Math.max(0, Math.min(1, state.tLeft / QUESTION_TIME_SEC));
    meterInner.style.transform = `scaleX(${ratio})`;

    const whole = Math.max(0, Math.ceil(state.tLeft));
    meterText.textContent = `${whole}s`;

    setWarn(whole <= WARN_AT_SEC && !state.finished);

    if (whole !== state.lastWholeSec) {
      state.lastWholeSec = whole;
      if (whole <= WARN_AT_SEC && whole >= 1) playOne(AUDIO.tick, { volume: 0.55 });
    }
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    state.tLeft = QUESTION_TIME_SEC;
    state.lastWholeSec = QUESTION_TIME_SEC;
    updateMeter();

    const startedAt = performance.now();
    state.timerId = setInterval(() => {
      const dt = (performance.now() - startedAt) / 1000;
      state.tLeft = Math.max(0, QUESTION_TIME_SEC - dt);
      updateMeter();

      if (state.tLeft <= 0.0001) {
        stopTimer();
        onTimeout();
      }
    }, 50);
  }

  function lockChoices(lock) {
    choicesEl.querySelectorAll("button.choiceBtn").forEach((b) => (b.disabled = !!lock));
  }

  // ===== game flow =====
  function renderQuestion() {
    renderHUD();
    const q = state.picks[state.idx];
    sourceEl.textContent = q.source ? `出典：${q.source}` : "";
    questionEl.innerHTML = renderHighlighted(q.question);

    choicesEl.innerHTML = "";
    q.choices.forEach((t, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "choiceBtn";
      b.innerHTML = renderHighlighted(t);
      b.addEventListener("click", () => onAnswer(i + 1, b));
      choicesEl.appendChild(b);
    });

    startTimer();
  }

  function onAnswer(choice, btn) {
    if (state.finished) return;

    stopTimer();
    lockChoices(true);

    const q = state.picks[state.idx];
    const correct = choice === q.answer;

    if (correct) {
      state.correct += 1;
      state.combo += 1;
      state.maxCombo = Math.max(state.maxCombo, state.combo);

      btn.classList.add("isCorrect");
      setWrapFx("fx-correct", 360); // ✅ CSSの青フラッシュが出る
      playOne(AUDIO.correct, { volume: 0.85 });

      punch(hudCorrect);
      punch(hudCombo);
    } else {
      state.combo = 0;
      hudCombo.classList.add("comboReset");
      window.setTimeout(() => hudCombo.classList.remove("comboReset"), 240);

      setWrapFx("fx-wrong", 420);  // ✅ CSSの赤フラッシュが出る
      playOne(AUDIO.wrong, { volume: 0.9 });

      choicesEl.querySelectorAll("button.choiceBtn").forEach((b) => {
        if (b !== btn) b.classList.add("isDim");
      });
    }

    renderHUD();
    window.setTimeout(nextStep, 420);
  }

  function onTimeout() {
    if (state.finished) return;

    state.combo = 0;
    hudCombo.classList.add("comboReset");
    window.setTimeout(() => hudCombo.classList.remove("comboReset"), 240);

    lockChoices(true);

    setWrapFx("fx-timeup", 420); // ✅ timeupも赤フラッシュ＋揺れ
    playOne(AUDIO.timeup, { volume: 0.9 });

    renderHUD();
    window.setTimeout(nextStep, 420);
  }

  function nextStep() {
    setWarn(false);
    state.idx += 1;
    if (state.idx >= TOTAL_QUESTIONS) finishGame();
    else renderQuestion();
  }

  function chooseRewardRarity() {
    if (state.correct >= 25 && state.maxCombo >= 5) return 5;
    if (state.correct >= 20 && state.correct <= 24) return 4;
    return 0;
  }

  function pickRandomCard(rarity) {
    const pool = state.cards.filter((c) => c.rarity === rarity);
    if (!pool.length) return null;
    return pool[(Math.random() * pool.length) | 0];
  }

  function finishGame() {
    state.finished = true;
    stopTimer();
    setWarn(false);
    try { AUDIO.bgm.pause(); } catch {}

    const rewardRarity = chooseRewardRarity();

    rCorrect.textContent = String(state.correct);
    rMaxCombo.textContent = String(state.maxCombo);

    if (rewardRarity === 5) {
      rReward.textContent = state.hkpSpentCost ? `★5 確定（HKP -${state.hkpSpentCost}）` : "★5 確定";
      resultTitle.textContent = "RESULT";
      resultTitle.classList.remove("failed");
    } else if (rewardRarity === 4) {
      rReward.textContent = state.hkpSpentCost ? `★4 確定（HKP -${state.hkpSpentCost}）` : "★4 確定";
      resultTitle.textContent = "RESULT";
      resultTitle.classList.remove("failed");
    } else {
      rReward.textContent = state.hkpSpentCost ? `なし（HKP -${state.hkpSpentCost}）` : "なし";
      resultTitle.textContent = "FAILED";
      resultTitle.classList.add("failed");
    }

    if (rewardRarity === 4 || rewardRarity === 5) {
      const card = pickRandomCard(rewardRarity);
      if (card) {
        addCardToCounts(card.id);
        cardImg.src = card.img || "";
        cardName.textContent = card.name || "";
        if (card.wiki) {
          cardWiki.href = card.wiki;
          cardWiki.style.display = "";
        } else {
          cardWiki.href = "#";
          cardWiki.style.display = "none";
        }
        cardArea.classList.remove("hidden");
      } else {
        cardArea.classList.add("hidden");
      }
    } else {
      cardArea.classList.add("hidden");
    }

    overlay.classList.remove("hidden");
  }

  function bootRun() {
    state.started = true;
    state.finished = false;

    state.idx = 0;
    state.correct = 0;
    state.combo = 0;
    state.maxCombo = 0;

    overlay.classList.add("hidden");
    renderQuestion();
  }

  // ===== Controls =====
  btnRetry.addEventListener("click", () => location.reload());
  btnAgain.addEventListener("click", () => location.reload());

  // ===== Init =====
  (async () => {
    updateBgmUI();
    try { AUDIO.bgm.pause(); } catch {}

    Object.values(AUDIO).forEach((a) => {
      if (!a) return;
      try { a.load(); } catch {}
    });

    try {
      await loadAll();
      questionEl.textContent = "準備完了。STARTで開始できます。";
      sourceEl.textContent = "";
      renderHUD();
    } catch (e) {
      questionEl.textContent = "読み込みに失敗しました。csv.js / CSV / パスを確認してください。";
      sourceEl.textContent = String(e?.message ?? e);
      console.error(e);
    }
  })();
})();
