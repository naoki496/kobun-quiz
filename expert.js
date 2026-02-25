/* expert.js (kobun-quiz EXPERT)
 * - Independent from app.js
 * - Uses csv.js: window.CSVUtil.load(url)
 * - Pre-start modal + START button (with alarm FX + fade out)
 * - BGM button (default ON in UI; actual playback starts on START gesture)
 * - 30 questions, 10 sec per question, timeout=wrong, combo breaks
 * - Reward: ★5 if correct>=25 AND maxCombo>=5, ★4 if correct 20-24, else none
 * - localStorage: hklobby.v1.cardCounts
 */
(() => {
  "use strict";

  // =========================
  // Config
  // =========================
  const TOTAL_QUESTIONS = 30;
  const QUESTION_TIME_SEC = 10;
  const WARN_AT_SEC = 3;

  const LS_KEY = "hklobby.v1.cardCounts";

  const AUDIO = {
    bgm: new Audio("./assets/bgmex.mp3"),
    correct: new Audio("./assets/correct.mp3"),
    wrong: new Audio("./assets/wrongex.mp3"),
    go: new Audio("./assets/goex.mp3"),
    tick: new Audio("./assets/tick.mp3"),
    timeup: new Audio("./assets/wrongex.mp3"), // ←ご指定どおり
  };

  AUDIO.bgm.loop = true;
  AUDIO.bgm.volume = 0.65;

  // =========================
  // DOM helpers
  // =========================
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

  // =========================
  // Meter DOM
  // =========================
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

  // =========================
  // Canvas FX (destination-out fade; avoids dark accumulation)
  // =========================
  const panel = document.querySelector(".panel");
  const fxCanvas = document.createElement("canvas");
  fxCanvas.width = 10;
  fxCanvas.height = 10;
  fxCanvas.style.position = "absolute";
  fxCanvas.style.inset = "0";
  fxCanvas.style.width = "100%";
  fxCanvas.style.height = "100%";
  fxCanvas.style.pointerEvents = "none";
  fxCanvas.style.zIndex = "0";
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

  let fxRunning = true;
  let fxT = 0;

  function fxTick() {
    if (!fxRunning) return;
    fxT += 1;

    // fade out previous frame (destination-out)
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
    ctx.restore();

    // crisis scanlines when warning active
    if (state.started && state.tLeft <= WARN_AT_SEC && !state.finished) {
      drawAlarmScan("warn");
    }

    requestAnimationFrame(fxTick);
  }
  requestAnimationFrame(fxTick);

  function drawAlarmScan(mode = "warn") {
    const w = fxCanvas.width;
    const h = fxCanvas.height;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";

    // denser scan lines
    ctx.fillStyle = "rgba(255,45,85,0.08)";
    for (let y = 0; y < h; y += (mode === "exit" ? 6 : 10)) {
      ctx.fillRect(0, y, w, 2);
    }

    // moving red sweep band (stronger on exit)
    const bandH = mode === "exit" ? 180 : 140;
    const speed = mode === "exit" ? 12 : 8;
    const bandY = (fxT * speed) % (h + bandH) - bandH;

    const grad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
    grad.addColorStop(0, "rgba(255,45,85,0)");
    grad.addColorStop(0.42, mode === "exit" ? "rgba(255,45,85,0.30)" : "rgba(255,45,85,0.22)");
    grad.addColorStop(0.58, mode === "exit" ? "rgba(255,45,85,0.30)" : "rgba(255,45,85,0.22)");
    grad.addColorStop(1, "rgba(255,45,85,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, bandY, w, bandH);

    // noise blocks (more dense on exit)
    const n = mode === "exit" ? 160 : 70;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const rw = 10 + Math.random() * (mode === "exit" ? 44 : 26);
      const rh = 1 + Math.random() * (mode === "exit" ? 6 : 4);
      ctx.fillStyle = `rgba(255,45,85,${mode === "exit" ? 0.05 : 0.035})`;
      ctx.fillRect(x, y, rw, rh);
    }

    ctx.restore();
  }

  // =========================
  // State
  // =========================
  const state = {
    started: false,
    finished: false,

    questions: [],
    picks: [],
    idx: 0,

    correct: 0,
    combo: 0,
    maxCombo: 0,

    tLeft: QUESTION_TIME_SEC,
    timerId: null,
    lastWholeSec: QUESTION_TIME_SEC,

    // ✅ BGM: 初期ON（UI上）だが、実再生はSTART押下で開始
    bgmOn: true,
    bgmArmed: false, // user gesture has occurred
    warnOn: false,

    cards: [],
  };

  // =========================
  // Utilities
  // =========================
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
    if (!el) return;
    el.classList.remove("punch");
    void el.offsetWidth;
    el.classList.add("punch");
  }

  function showCombo5Toast() {
    const toast = document.createElement("div");
    toast.className = "comboToast";
    toast.textContent = "COMBO 5: OVERDRIVE";
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    window.setTimeout(() => toast.remove(), 1300);
  }

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

  // =========================
  // BGM button
  // =========================
  function updateBgmUI() {
    btnBgm.setAttribute("aria-pressed", state.bgmOn ? "true" : "false");
    btnBgm.textContent = state.bgmOn ? "BGM: ON" : "BGM: OFF";
    noteEl.textContent = state.bgmOn
      ? "音：ON（STARTで再生開始）"
      : "音：OFF";
  }

  function setBgm(on) {
    state.bgmOn = !!on;
    updateBgmUI();

    // 実再生は「START押下済み(bgmArmed=true)」でのみ許可
    if (!state.bgmArmed) return;

    if (state.bgmOn) {
      playOne(AUDIO.bgm, { restart: false });
    } else {
      try { AUDIO.bgm.pause(); } catch {}
    }
  }

  btnBgm.addEventListener("click", () => {
    setBgm(!state.bgmOn);
  });

  // =========================
  // Start overlay flow
  // =========================
  async function runCountdown() {
    countdownEl.classList.remove("hidden");
    const seq = ["3", "2", "1", "GO"];
    for (const s of seq) {
      countdownEl.textContent = s;
      countdownEl.classList.remove("pop");
      void countdownEl.offsetWidth;
      countdownEl.classList.add("pop");
      if (s === "GO") playOne(AUDIO.go, { volume: 0.9 });
      await new Promise((r) => setTimeout(r, 520));
    }
    countdownEl.classList.add("hidden");
    countdownEl.textContent = "";
  }

  function hideStartOverlayWithFX() {
    // CSS leaving animation
    startOverlay.classList.add("leaving");
    startCard.classList.add("leaving");

    // Canvas: alarm burst (red scan + dense noise)
    drawAlarmScan("exit");

    // additional burst streaks
    const w = fxCanvas.width, h = fxCanvas.height;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < 55; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 24 + Math.random() * 80;
      const th = 1 + Math.random() * 4;
      ctx.fillStyle = `rgba(255,45,85,${0.06 + Math.random() * 0.10})`;
      ctx.fillRect(x, y, len, th);
    }
    ctx.restore();

    window.setTimeout(() => {
      startOverlay.classList.add("hidden");
    }, 420);
  }

  async function startGameFromOverlay() {
    // ✅ START押下が唯一の開始トリガ
    if (state.started) return;

    // mark user gesture for autoplay restrictions
    state.bgmArmed = true;

    // hide overlay with alarm FX
    hideStartOverlayWithFX();

    // if BGM is ON, start playback NOW (this is the user gesture path)
    if (state.bgmOn) {
      playOne(AUDIO.bgm, { restart: false });
    }

    await runCountdown();
    bootRun();
  }

  // Start button only
  btnStart.addEventListener("click", () => {
    startGameFromOverlay();
  });

  // =========================
  // Boot / Data Load
  // =========================
  async function loadAll() {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil.load が見つかりません。expert.html で csv.js を先に読み込んでください。");
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

  // =========================
  // Game loop
  // =========================
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
      if (whole <= WARN_AT_SEC && whole >= 1) {
        playOne(AUDIO.tick, { volume: 0.55 });
      }
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
    const btns = choicesEl.querySelectorAll("button.choiceBtn");
    btns.forEach((b) => (b.disabled = !!lock));
  }

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
      setWrapFx("fx-correct", 360);
      playOne(AUDIO.correct, { volume: 0.85 });

      punch(hudCorrect);
      punch(hudCombo);

      if (state.combo === 5) {
        wrap.classList.add("fx-combo5");
        window.setTimeout(() => wrap.classList.remove("fx-combo5"), 900);
        showCombo5Toast();
      }
    } else {
      state.combo = 0;
      hudCombo.classList.add("comboReset");
      window.setTimeout(() => hudCombo.classList.remove("comboReset"), 240);

      setWrapFx("fx-wrong", 420);
      playOne(AUDIO.wrong, { volume: 0.9 });
      dimOtherChoices(btn);
    }

    renderHUD();
    window.setTimeout(nextStep, 420);
  }

  function dimOtherChoices(clickedBtn) {
    const btns = choicesEl.querySelectorAll("button.choiceBtn");
    btns.forEach((b) => {
      if (b !== clickedBtn) b.classList.add("isDim");
    });
  }

  function onTimeout() {
    if (state.finished) return;

    state.combo = 0;
    hudCombo.classList.add("comboReset");
    window.setTimeout(() => hudCombo.classList.remove("comboReset"), 240);

    lockChoices(true);
    setWrapFx("fx-timeup", 520);
    playOne(AUDIO.timeup, { volume: 0.9 });

    renderHUD();
    window.setTimeout(nextStep, 520);
  }

  function nextStep() {
    setWarn(false);

    state.idx += 1;
    if (state.idx >= TOTAL_QUESTIONS) {
      finishGame();
      return;
    }
    renderQuestion();
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
      rReward.textContent = "★5 確定";
      resultTitle.textContent = "RESULT";
      resultTitle.classList.remove("failed");
    } else if (rewardRarity === 4) {
      rReward.textContent = "★4 確定";
      resultTitle.textContent = "RESULT";
      resultTitle.classList.remove("failed");
    } else {
      rReward.textContent = "なし";
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

  // =========================
  // Controls
  // =========================
  btnRetry.addEventListener("click", () => location.reload());
  btnAgain.addEventListener("click", () => location.reload());

  // =========================
  // Boot run (after start overlay)
  // =========================
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

  // =========================
  // Init
  // =========================
  (async () => {
    // ✅ BGM初期ON（UI表示）だが、START押下までは実際に鳴らさない
    updateBgmUI();
    try { AUDIO.bgm.pause(); } catch {}

    // preload (non-blocking)
    Object.values(AUDIO).forEach((a) => {
      if (!a) return;
      try { a.load(); } catch {}
    });

    // load data
    try {
      await loadAll();
      questionEl.textContent = "準備完了。STARTで開始できます。";
      sourceEl.textContent = "";
      renderHUD();
    } catch (e) {
      questionEl.textContent = "読み込みに失敗しました。csv.js / CSV / パスを確認してください。";
      sourceEl.textContent = String(e?.message ?? e);
      console.error(e);
      return;
    }

    // ✅ ここで自動開始は“しない”
    //    （STARTを押さないのに進行する問題の根治）
  })();
})();
