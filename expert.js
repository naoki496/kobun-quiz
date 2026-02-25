/* expert.js (kobun-quiz EXPERT)
 * - Independent from app.js
 * - Uses csv.js: window.CSVUtil.load(url)
 * - Pre-start modal + START button (with FX + fade out)
 * - BGM ON/OFF button
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
    timeup: new Audio("./assets/wrongex.mp3"), // ←ご指定どおり wrongex.mp3
  };

  // BGM defaults OFF (button turns it ON)
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
  // Canvas FX (destination-out fade; avoids "dark accumulation")
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
  fxCanvas.style.zIndex = "0"; // behind content (panel children have z-index:1)
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
      const w = fxCanvas.width;
      const h = fxCanvas.height;

      ctx.save();
      ctx.globalCompositeOperation = "source-over";

      // moving red sweep band
      const bandY = (fxT * 8) % (h + 140) - 140;
      const grad = ctx.createLinearGradient(0, bandY, 0, bandY + 140);
      grad.addColorStop(0, "rgba(255,45,85,0)");
      grad.addColorStop(0.45, "rgba(255,45,85,0.22)");
      grad.addColorStop(0.55, "rgba(255,45,85,0.22)");
      grad.addColorStop(1, "rgba(255,45,85,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, bandY, w, 140);

      // scan lines
      ctx.fillStyle = "rgba(255,45,85,0.06)";
      for (let y = 0; y < h; y += 10) {
        ctx.fillRect(0, y, w, 2);
      }

      ctx.restore();
    }

    requestAnimationFrame(fxTick);
  }
  requestAnimationFrame(fxTick);

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

    bgmOn: false,
    warnOn: false,

    cards: [],
    autostart: false,
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

  // Highlight 【...】
  function renderHighlighted(text) {
    const s = String(text ?? "");
    // replace all occurrences of 【...】 non-greedy
    return esc(s).replace(/【(.*?)】/g, (_m, p1) => `<span class="hl">【${esc(p1)}】</span>`);
  }

  function playOne(audio, { volume, restart = true } = {}) {
    if (!audio) return;
    try {
      if (typeof volume === "number") audio.volume = volume;
      if (restart) audio.currentTime = 0;
      // For mobile, play requires a user gesture; START button provides that.
      audio.play().catch(() => {});
    } catch {
      // ignore
    }
  }

  function setWrapFx(cls, dur = 360) {
    wrap.classList.add(cls);
    window.setTimeout(() => wrap.classList.remove(cls), dur);
  }

  function punch(el) {
    if (!el) return;
    el.classList.remove("punch");
    // force reflow
    void el.offsetWidth;
    el.classList.add("punch");
  }

  function showCombo5Toast() {
    const toast = document.createElement("div");
    toast.className = "comboToast";
    toast.textContent = "COMBO 5: OVERDRIVE";
    document.body.appendChild(toast);
    // trigger anim
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
    } catch {
      // ignore
    }
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
    noteEl.textContent = state.bgmOn ? "音：ON" : "音：OFF（BGMボタンでON）";
  }

  function setBgm(on) {
    state.bgmOn = !!on;
    updateBgmUI();
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
  function hideStartOverlayWithFX() {
    // Add leaving classes (CSS anim)
    startOverlay.classList.add("leaving");
    startCard.classList.add("leaving");

    // Add a short canvas burst (non-black accumulating)
    const w = fxCanvas.width;
    const h = fxCanvas.height;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    // quick bright ring
    ctx.strokeStyle = "rgba(0,229,255,0.35)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.35, 120, 0, Math.PI * 2);
    ctx.stroke();
    // red fragments
    for (let i = 0; i < 28; i++) {
      const x = w * 0.2 + Math.random() * w * 0.6;
      const y = h * 0.2 + Math.random() * h * 0.5;
      ctx.fillStyle = `rgba(255,45,85,${0.08 + Math.random() * 0.18})`;
      ctx.fillRect(x, y, 8 + Math.random() * 24, 1.5 + Math.random() * 3);
    }
    ctx.restore();

    window.setTimeout(() => {
      startOverlay.classList.add("hidden");
    }, 420);
  }

  async function runCountdown() {
    countdownEl.classList.remove("hidden");
    const seq = ["3", "2", "1", "GO"];
    for (const s of seq) {
      countdownEl.textContent = s;
      countdownEl.classList.remove("pop");
      void countdownEl.offsetWidth;
      countdownEl.classList.add("pop");
      if (s === "GO") {
        playOne(AUDIO.go, { volume: 0.9 });
      }
      await new Promise((r) => setTimeout(r, 520));
    }
    countdownEl.classList.add("hidden");
    countdownEl.textContent = "";
  }

  async function startGameFromOverlay() {
    if (state.started) return;
    // user gesture path -> safe to start audio later
    hideStartOverlayWithFX();
    await runCountdown();
    bootRun();
  }

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

    // pick random 30
    const picks = shuffle(questions).slice(0, TOTAL_QUESTIONS);
    state.picks = picks;
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

    // tick only when seconds change and only in warning zone
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

    // Show reward card if any
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
        // if no cards found, still no crash
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
    // Parse URL params
    const params = new URLSearchParams(location.search);
    state.autostart = params.get("start") === "1";

    // default BGM OFF
    setBgm(false);

    // preload minimal (non-blocking)
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

    // autostart: still shows overlay briefly then starts (START UIを尊重しつつ自動実行)
    if (state.autostart) {
      // 小さく猶予（ロード/描画を落ち着かせる）
      window.setTimeout(() => {
        startGameFromOverlay();
      }, 250);
    }
  })();
})();
