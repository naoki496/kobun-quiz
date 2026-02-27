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

  (function setupExpertDebugWindow() {
    try {
      const params = new URLSearchParams(location.search);
      if (params.get(EXPERT_DEBUG_PARAM_KEY) === "1") {
        localStorage.setItem(
          EXPERT_DEBUG_UNTIL_KEY,
          String(Date.now() + EXPERT_DEBUG_WINDOW_MS)
        );
      }
    } catch {}
  })();

  function isExpertDebugActive() {
    try {
      const until = Number(localStorage.getItem(EXPERT_DEBUG_UNTIL_KEY) || "0");
      return Number.isFinite(until) && Date.now() < until;
    } catch {
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
    localStorage.setItem(HKP_KEY, String(Number(v) | 0));
  }
  function addHKP(delta) {
    const cur = getHKP();
    const next = (cur + (Number(delta) | 0)) | 0;
    setHKP(next);
    return next;
  }

  // ===== HKP Gate UI (visualize cost / balance; disable START if insufficient) =====
  function renderGateUI() {
    const gate = document.getElementById("gate");
    const costEl = document.getElementById("hkpCost");
    const nowEl = document.getElementById("hkpNow");
    const msgEl = document.getElementById("gateMsg");

    if (costEl) costEl.textContent = String(HKP_COST_EXPERT);

    const cur = getHKP();
    if (nowEl) nowEl.textContent = String(cur);

    const debug = isExpertDebugActive();
    const ok = debug || cur >= HKP_COST_EXPERT;

    if (gate) {
      gate.classList.toggle("isOk", ok);
      gate.classList.toggle("isInsufficient", !ok);
      gate.dataset.state = debug ? "debug" : (ok ? "ok" : "bad");
    }

    if (msgEl) {
      if (debug) {
        msgEl.textContent = "DEBUG ACCESS：HKPチェックを一時バイパス中（10分）";
      } else if (ok) {
        msgEl.textContent = "契約承認：STARTでHKPを消費し、EXPERTへ突入します。";
      } else {
        msgEl.textContent = `契約不成立：HKP不足（必要 ${HKP_COST_EXPERT} / 所持 ${cur}）`;
      }
    }

    // STARTボタンを無効化（形状は変えない）
    try {
      btnStart.disabled = !ok;
      btnStart.setAttribute("aria-disabled", String(!ok));
      btnStart.style.opacity = ok ? "" : "0.55";
    } catch {}
  }

  // 他タブでHKPが変動したら反映
  window.addEventListener("storage", (e) => {
    if (e && e.key === HKP_KEY) renderGateUI();
  });
  // ===== /HKP Gate UI =====

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
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(obj || {}));
    } catch {}
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

// ===== HUD compact (mobile only) =====
function applyHudCompactIfMobile() {
  if (!window.matchMedia || !window.matchMedia("(max-width: 520px)").matches) return;

  const nodes = [hudQ, hudCorrect, hudCombo, hudMaxCombo].filter(Boolean);
  nodes.forEach((n) => {
    const cell = n && n.parentElement;
    if (!cell) return;
    cell.style.padding = "6px 8px";
    cell.style.lineHeight = "1.1";
    cell.style.minHeight = "0";
  });

  // best-effort: reduce gap on common ancestor
  const a = hudQ && (hudQ.closest && (hudQ.closest(".hud") || hudQ.closest(".hudGrid"))) ||
            (hudQ && hudQ.parentElement && hudQ.parentElement.parentElement);
  if (a && a.style) {
    a.style.gap = "6px";
    a.style.marginBottom = "10px";
  }
}

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

  // 初期表示：HKP所持/消費を明示し、押下可否を反映
  renderGateUI();

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


// ===== warn sweep trigger (once per second in last WARN_AT_SEC) =====
let alarmSweepActive = false;
let alarmSweepStart = 0;
function triggerAlarmSweep() {
  alarmSweepActive = true;
  alarmSweepStart = performance.now();
}

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
if (mode === "warn") {
  if (!alarmSweepActive) { ctx.restore(); return; }

  const bandH = 135;
  const p = (performance.now() - alarmSweepStart) / 1000;
  if (p >= 1.05) { alarmSweepActive = false; ctx.restore(); return; }

  const bandY = (-bandH) + (h + bandH) * p;

  const grad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
  grad.addColorStop(0, "rgba(255,45,85,0)");
  grad.addColorStop(0.5, "rgba(255,45,85,0.14)");
  grad.addColorStop(1, "rgba(255,45,85,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, bandY, w, bandH);

  // noise blocks (warn)
  const n = 45;
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const rw = 10 + Math.random() * 22;
    const rh = 1 + Math.random() * 3;
    ctx.fillStyle = "rgba(255,45,85,0.028)";
    ctx.fillRect(x, y, rw, rh);
  }

  ctx.restore();
  return;
}

const bandH = 170;
const speed = 11;
const bandY = (fxT * speed) % (h + bandH) - bandH;

const grad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
    grad.addColorStop(0, "rgba(255,45,85,0)");
    grad.addColorStop(
      0.45,
      mode === "exit" ? "rgba(255,45,85,0.18)" : "rgba(255,45,85,0.12)"
    );
    grad.addColorStop(
      0.55,
      mode === "exit" ? "rgba(255,45,85,0.18)" : "rgba(255,45,85,0.12)"
    );
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

    bgmOn: true, // UI default ON
    bgmArmed: false, // becomes true after START gesture
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
    // escape first, then safely wrap brackets with highlight span
    const safe = esc(s);

    // 【...】 highlight (yellow) — matches existing .hl in styles.css
    const withKakko = safe.replace(/【(.*?)】/g, (_m, p1) => `<span class="hl">【${p1}】</span>`);

    // keep 〖...〗 as-is (already escaped); no extra highlight by default
    return withKakko.replace(/〖(.*?)〗/g, (_m, p1) => `〖${p1}〗`);
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
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(counts));
    } catch {}
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
    else {
      try {
        AUDIO.bgm.pause();
      } catch {}
    }
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
        renderGateUI();
        try {
          setWrapFx("fx-wrong", 260);
        } catch {}
        return;
      }

      if (!isExpertDebugActive()) {
        addHKP(-HKP_COST_EXPERT);
        markProcessed(spendKey);
        state.hkpSpentCost = HKP_COST_EXPERT;
        renderGateUI();
      }
    } else {
      // Already processed for this runId (should not happen because runId is new), keep safe.
    }

    // UI gating unlock: user gesture allows audio
    state.bgmArmed = true;

    // respect UI state
    updateBgmUI();
    if (state.bgmOn) playOne(AUDIO.bgm, { restart: false });

    hideStartOverlayWithFX();
    await runCountdown();

    bootGame();
  }

  btnStart.addEventListener("click", startGameFromOverlay);

  // ===== data loading =====
  async function loadCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch failed: ${res.status} (${url})`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    const head = lines.shift().split(",");
    return lines.map((line) => {
      const cols = line.split(",");
      const obj = {};
      head.forEach((h, i) => (obj[h.trim()] = (cols[i] ?? "").trim()));
      return obj;
    });
  }

  function normalizeRow(r) {
    const id = String(r.id ?? "").trim();
    const question = String(r.question ?? "").trim();
    const source = String(r.source ?? "").trim();

    const choices = [
      String(r.choice1 ?? "").trim(),
      String(r.choice2 ?? "").trim(),
      String(r.choice3 ?? "").trim(),
      String(r.choice4 ?? "").trim(),
    ];

    const ans = Number(String(r.answer ?? "").trim());
    if (!(ans >= 1 && ans <= 4)) throw new Error(`answer が 1〜4 ではありません: "${r.answer}" (id=${id})`);

    return { id, question, source, choices, ans };
  }

  async function loadQuestions() {
    const candidates = ["./questions.csv", "./expert.csv", "questions.csv", "expert.csv"];
    let rows = null;
    let lastErr = null;
    for (const url of candidates) {
      try {
        rows = await loadCsv(url);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!rows) throw lastErr || new Error("fetch failed: 404");
    const qs = rows.map(normalizeRow);
    return shuffle(qs).slice(0, TOTAL_QUESTIONS);
  }

  async function loadCards() {
    // cards.csv: id,rarity,name,img,wiki
    const rows = await loadCsv("./cards.csv");
    const cards = rows.map((r) => ({
      id: String(r.id ?? "").trim(),
      rarity: Number(r.rarity) || 0,
      name: String(r.name ?? "").trim(),
      img: String(r.img ?? "").trim(),
      wiki: String(r.wiki ?? "").trim(),
    }));
    return cards.filter((c) => c.id && c.img);
  }

  // ===== game boot =====
  async function bootGame() {
    state.started = true;
    applyHudCompactIfMobile();
    state.finished = false;

    state.idx = 0;
    state.correct = 0;
    state.combo = 0;
    state.maxCombo = 0;

    btnRetry.classList.add("hidden");
    overlay.classList.add("hidden");
    cardArea.classList.add("hidden");

    hudCorrect.textContent = "0";
    hudCombo.textContent = "0";
    hudMaxCombo.textContent = "0";

    try {
      state.questions = await loadQuestions();
      state.cards = await loadCards();
    } catch (e) {
      // show fatal load error (prevents infinite "loading")
      state.finished = true;
      stopTimer();
      overlay.classList.remove("hidden");
      cardArea.classList.add("hidden");
      btnAgain.classList.add("hidden");
      btnRetry.classList.remove("hidden");
      resultTitle.textContent = "LOAD ERROR";
      rCorrect.textContent = "-";
      rMaxCombo.textContent = "-";
      rReward.textContent = "データ読み込みに失敗しました";
      note.textContent = String(e && e.message ? e.message : e);
      console.error(e);
      return;
    }

    renderQ();
    startTimer();
  }

  // ===== timer =====
  function setMeter(t) {
    const frac = Math.max(0, Math.min(1, t / QUESTION_TIME_SEC));
    meterInner.style.width = `${(frac * 100).toFixed(1)}%`;
    meterText.textContent = `${Math.max(0, t | 0)}s`;
  }



// NOTE: timer is rAF-based to keep meter smooth on mobile.
function startTimer() {
  stopTimer();

  const start = performance.now();
  const end = start + QUESTION_TIME_SEC * 1000;

  state.tLeft = QUESTION_TIME_SEC;
  state.lastWholeSec = QUESTION_TIME_SEC;
  setMeter(state.tLeft);

  const loop = () => {
    if (state.finished) return;

    const now = performance.now();
    const left = Math.max(0, (end - now) / 1000);
    state.tLeft = left;

    const whole = Math.ceil(left);
    if (whole !== state.lastWholeSec) {
      state.lastWholeSec = whole;
      if (whole <= WARN_AT_SEC && whole >= 1) {
        playOne(AUDIO.tick, { volume: 0.75 });
        triggerAlarmSweep(); // ✅ 3,2,1... each second
      }
    }

    setMeter(left);

    if (left <= 0) {
      stopTimer();
      onPick(-1);
      return;
    }

    state.timerId = requestAnimationFrame(loop);
  };

  state.timerId = requestAnimationFrame(loop);
}

function stopTimer() {
  if (state.timerId) {
    try { cancelAnimationFrame(state.timerId); } catch {}
    try { window.clearInterval(state.timerId); } catch {} // compat
    state.timerId = null;
  }
}


  // ===== render question =====
  function renderQ() {
    const q = state.questions[state.idx];
    hudQ.textContent = `${state.idx + 1}/${TOTAL_QUESTIONS}`;
    sourceEl.textContent = q.source || "";
    questionEl.innerHTML = renderHighlighted(q.question);

    choicesEl.innerHTML = "";
    q.choices.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.type = "button";
      const cleaned = String(c ?? "").replace(/^\s*[1-4][\.\)\］\]\、,:：\-]?\s*/, "");
      btn.innerHTML = `<span class="cNo">${i + 1}</span><span class="cText">${esc(cleaned)}</span>`;
      btn.addEventListener("click", () => onPick(i + 1));
      choicesEl.appendChild(btn);
    });
  }

  function lockChoices() {
    const btns = choicesEl.querySelectorAll("button.choice");
    btns.forEach((b) => (b.disabled = true));
  }

  function onPick(choiceNo) {
    if (state.finished) return;

    stopTimer();
    lockChoices();

    const q = state.questions[state.idx];
    const isCorrect = choiceNo === q.ans;

    if (isCorrect) {
      state.correct += 1;
      state.combo += 1;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      playOne(AUDIO.correct, { volume: 0.9 });
      setWrapFx("fx-correct", 320);
    } else {
      state.combo = 0;
      playOne(AUDIO.wrong, { volume: 0.9 });
      setWrapFx("fx-wrong", 360);
    }

    hudCorrect.textContent = String(state.correct);
    hudCombo.textContent = String(state.combo);
    hudMaxCombo.textContent = String(state.maxCombo);

    punch(hudCorrect);
    punch(hudCombo);

    state.picks.push({ id: q.id, pick: choiceNo, ans: q.ans });

    window.setTimeout(() => {
      state.idx += 1;
      if (state.idx >= TOTAL_QUESTIONS) finishGame();
      else {
        renderQ();
        startTimer();
      }
    }, 260);
  }

  // ===== reward =====
  function pickRewardRarity() {
    // ★5 if >=25 & maxCombo>=5, ★4 if 20..24, else none
    if (state.correct >= 25 && state.maxCombo >= 5) return 5;
    if (state.correct >= 20 && state.correct <= 24) return 4;
    return 0;
  }

  function pickCardByRarity(rarity) {
    const pool = state.cards.filter((c) => Number(c.rarity) === Number(rarity));
    if (!pool.length) return null;
    return pool[(Math.random() * pool.length) | 0];
  }

  function awardCard(card) {
    if (!card) return;
    addCardToCounts(card.id);
  }

  function showCard(card) {
    if (!card) return;
    cardArea.classList.remove("hidden");
    cardImg.src = card.img;
    cardName.textContent = card.name || "";
    cardWiki.href = card.wiki || "#";
  }

  function finishGame() {
    state.finished = true;
    stopTimer();

    overlay.classList.remove("hidden");

    rCorrect.textContent = String(state.correct);
    rMaxCombo.textContent = String(state.maxCombo);

    const rarity = pickRewardRarity();
    let rewardText = "報酬なし";
    if (rarity === 5) rewardText = "★5確定";
    else if (rarity === 4) rewardText = "★4";

    rReward.textContent = rewardText;
    resultTitle.textContent = rarity ? "CLEAR" : "RESULT";

    let card = null;
    if (rarity) {
      const runId = state.runId || "";
      const awardKey = `award${rarity}:${runId}`;
      if (!isProcessed(awardKey)) {
        card = pickCardByRarity(rarity);
        if (card) {
          awardCard(card);
          markProcessed(awardKey);
        }
      }
    }

    if (card) showCard(card);
    else cardArea.classList.add("hidden");

    btnAgain.classList.remove("hidden");
  }

  btnAgain.addEventListener("click", () => {
    // restart from overlay (new runId)
    state.started = false;
    state.finished = false;
    state.picks = [];
    state.questions = [];
    state.idx = 0;

    overlay.classList.add("hidden");
    startOverlay.classList.remove("hidden");
    startOverlay.classList.remove("leaving");
    startCard.classList.remove("leaving");
    btnRetry.classList.add("hidden");

    // refresh gate view
    renderGateUI();
  });

  btnRetry.addEventListener("click", () => {
    location.reload();
  });

  // ===== init =====
  // arm UI
  updateBgmUI();
})();
