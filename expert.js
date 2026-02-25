/* EXPERT mode (isolated)
 * - 30 questions
 * - 10 sec each
 * - timeout = wrong (combo breaks)
 * - Reward rules:
 *   ★5 guaranteed: correct >= 25 AND maxCombo >= 5
 *   ★4 guaranteed: correct 20..24
 *   else: no reward (★3 never appears)
 * - Card counts saved to localStorage key: hklobby.v1.cardCounts
 *
 * Add-ons:
 * - Canvas particle FX (screen overlay, lightweight)  ✅ fixed: no dark accumulation
 * - Combo-5 achievement FX (once per run)
 * - Highlight supports 【】 and 〖〗
 */
(() => {
  "use strict";

  // =========================
  // DOM helpers (MUST be first)
  // =========================
  const $id = (id) => document.getElementById(id);

  function requireEl(id) {
    const n = $id(id);
    if (!n) throw new Error(`DOM not found: #${id}`);
    return n;
  }

  // =========================
  // Config
  // =========================
  const QUESTIONS_URL = "./questions.csv";
  const CARDS_URL = "./cards.csv";

  const TOTAL_QUESTIONS = 30;
  const QUESTION_TIME_SEC = 10;
  const WARN_AT_SEC = 3;

  const LS_KEY = "hklobby.v1.cardCounts";

  // Use existing assets from kobun-quiz/app.js
  const AUDIO = {
    bgm: new Audio("./assets/bgmex.mp3"),
    correct: new Audio("./assets/correct.mp3"),
    wrong: new Audio("./assets/wrongex.mp3"),
    go: new Audio("./assets/goex.mp3"),
    tick: new Audio("./assets/tick.mp3"),
    timeup: null,
  };

  // =========================
  // DOM
  // =========================
  const el = {
    meterArea: requireEl("meterArea"),
    source: requireEl("source"),
    question: requireEl("question"),
    choices: requireEl("choices"),

    hudQ: requireEl("hudQ"),
    hudCorrect: requireEl("hudCorrect"),
    hudCombo: requireEl("hudCombo"),
    hudMaxCombo: requireEl("hudMaxCombo"),

    note: requireEl("note"),
    btnRetry: requireEl("btnRetry"),

    overlay: requireEl("overlay"),
    resultTitle: requireEl("resultTitle"),
    rCorrect: requireEl("rCorrect"),
    rMaxCombo: requireEl("rMaxCombo"),
    rReward: requireEl("rReward"),

    cardArea: requireEl("cardArea"),
    cardImg: requireEl("cardImg"),
    cardName: requireEl("cardName"),
    cardWiki: requireEl("cardWiki"),

    btnAgain: requireEl("btnAgain"),
    countdown: requireEl("countdown"),
    app: requireEl("app"),
  };

  // =========================
  // State
  // =========================
  const state = {
    questions: [],
    cards4: [],
    cards5: [],
    selected: [],
    qIndex: 0,
    correct: 0,
    combo: 0,
    maxCombo: 0,
    locked: false,

    timer: {
      t0: 0,
      remainingMs: 0,
      rafId: 0,
      running: false,
      warned: false,
    },

    audioUnlocked: false,
    autostart: false,

    combo5Triggered: false,

    fx: {
      canvas: null,
      ctx: null,
      dpr: Math.min(2, window.devicePixelRatio || 1),
      w: 0,
      h: 0,
      particles: [],
      raf: 0,
      lastTs: 0,
    },
  };

  // =========================
  // Boot
  // =========================
  boot().catch((err) => {
    console.error(err);
    const msg = err?.message ? String(err.message) : String(err);
    hardFail("起動エラー: " + msg + "\n（Console/Network を確認）");
  });

  async function boot() {
    injectMeter();
    injectFXLayer();

    const params = new URLSearchParams(location.search);
    state.autostart = params.get("start") === "1";

    document.addEventListener("pointerdown", () => {
      if (!state.audioUnlocked) unlockAudio();
    });

    el.btnRetry.addEventListener("click", () => startNewRun(true));
    el.btnAgain.addEventListener("click", () => startNewRun(true));

    if (!window.CSVUtil?.load) {
      throw new Error("CSVUtil.load が見つかりません（csv.js の読み込み順/配置を確認）");
    }

    const [qRows, cRows] = await Promise.all([
      window.CSVUtil.load(QUESTIONS_URL),
      window.CSVUtil.load(CARDS_URL),
    ]);

    state.questions = qRows.map(normalizeQuestionRow).filter(Boolean);
    const allCards = cRows.map(normalizeCardRow).filter(Boolean);

    state.cards4 = allCards.filter((c) => c.rarity === 4);
    state.cards5 = allCards.filter((c) => c.rarity === 5);

    if (state.questions.length < TOTAL_QUESTIONS) {
      throw new Error(`questions.csv の問題数不足（必要 ${TOTAL_QUESTIONS} / 現在 ${state.questions.length}）`);
    }
    if (state.cards4.length === 0) throw new Error("cards.csv に★4がありません");
    if (state.cards5.length === 0) throw new Error("cards.csv に★5がありません");

    el.source.textContent = "";
    el.question.textContent = "EXPERT準備完了。リトライで開始。";
    renderHUD();

    if (state.autostart) startNewRun(true);
  }

  // =========================
  // HUD
  // =========================
  function renderHUD() {
    el.hudQ.textContent = `${Math.min(state.qIndex + 1, TOTAL_QUESTIONS)}/${TOTAL_QUESTIONS}`;
    el.hudCorrect.textContent = String(state.correct);
    el.hudCombo.textContent = String(state.combo);
    el.hudMaxCombo.textContent = String(state.maxCombo);
  }

  // =========================
  // Run control
  // =========================
  function startNewRun(withCountdown) {
    hideOverlay();
    resetRun();

    state.selected = pickRandomQuestions(state.questions, TOTAL_QUESTIONS);
    renderHUD();

    if (withCountdown) {
      showCountdown(async () => {
        maybePlay(AUDIO.go);
        startQuestion();
      });
    } else {
      startQuestion();
    }
  }

  function resetRun() {
    state.qIndex = 0;
    state.correct = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.locked = false;
    state.combo5Triggered = false;
    stopTimer();
    clearFX();
    fxClearAll();
  }

  // =========================
  // Question flow
  // =========================
  function startQuestion() {
    clearFX();
    state.locked = false;

    const q = state.selected[state.qIndex];
    el.source.textContent = q.source ? `出典：${q.source}` : "";
    el.question.innerHTML = renderHighlighted(q.question);

    el.choices.innerHTML = "";
    q.choices.forEach((text, i) => {
      const btn = document.createElement("button");
      btn.className = "choiceBtn";
      btn.type = "button";
      btn.innerHTML = renderHighlighted(text);
      btn.addEventListener("click", () => onAnswer(i + 1));
      el.choices.appendChild(btn);
    });

    renderHUD();
    startTimer();
  }

  function onAnswer(choiceNum) {
    if (state.locked) return;
    state.locked = true;

    stopTimer();

    const q = state.selected[state.qIndex];
    const ok = choiceNum === q.answer;

    if (ok) {
      state.correct += 1;
      state.combo += 1;
      state.maxCombo = Math.max(state.maxCombo, state.combo);

      if (!state.combo5Triggered && state.maxCombo >= 5) {
        state.combo5Triggered = true;
        playCombo5FX();
      }

      playCorrectFX();
    } else {
      state.combo = 0;
      playWrongFX();
      markCorrectAnswer(q.answer);
    }

    renderHUD();
    setTimeout(advanceOrFinish, 650);
  }

  function onTimeout() {
    if (state.locked) return;
    state.locked = true;

    state.combo = 0;
    playTimeoutFX();

    const q = state.selected[state.qIndex];
    markCorrectAnswer(q.answer);

    renderHUD();
    setTimeout(advanceOrFinish, 850);
  }

  function advanceOrFinish() {
    state.qIndex += 1;
    if (state.qIndex >= TOTAL_QUESTIONS) finishRun();
    else startQuestion();
  }

  // =========================
  // Finish & reward
  // =========================
  function finishRun() {
    stopTimer();
    clearFX();

    const rarity = decideRewardRarity(state.correct, state.maxCombo);

    el.rCorrect.textContent = String(state.correct);
    el.rMaxCombo.textContent = String(state.maxCombo);

    if (rarity === 5) {
      el.rReward.textContent = "★5 確定（25+ & MAX COMBO ≥ 5）";
      const card = rollCardByRarity(5);
      grantCard(card);
      showOverlay(card, 5);
      fxBurstAtCenter(120, 16, 1.0);
      fxRingAtCenter(1.0);
      return;
    }
    if (rarity === 4) {
      el.rReward.textContent = "★4 確定（20〜24）";
      const card = rollCardByRarity(4);
      grantCard(card);
      showOverlay(card, 4);
      fxBurstAtCenter(80, 14, 0.75);
      fxRingAtCenter(0.8);
      return;
    }

    el.rReward.textContent = "報酬なし（★3は出ません）";
    showOverlay(null, null);
    fxGlitchSweep(0.9);
  }

  function decideRewardRarity(correctCount, maxCombo) {
    if (correctCount >= 25 && maxCombo >= 5) return 5;
    if (correctCount >= 20 && correctCount <= 24) return 4;
    return null;
  }

  function rollCardByRarity(r) {
    const pool = r === 5 ? state.cards5 : state.cards4;
    return weightedPick(pool);
  }

  function grantCard(card) {
    if (!card) return;
    const counts = readCounts();
    counts[card.id] = (counts[card.id] || 0) + 1;
    writeCounts(counts);
  }

  // =========================
  // FX (CSS classes + Canvas)
  // =========================
  function playCorrectFX() {
    maybePlay(AUDIO.correct);
    el.app.classList.add("fx-correct");
    bumpCombo(false);
    fxBurstAtEl(el.question, 38, 10, 0.55);
    fxConfettiSpray(el.question, 22, 0.55);
  }

  function playWrongFX() {
    maybePlay(AUDIO.wrong);
    el.app.classList.add("fx-wrong");
    bumpCombo(true);
    fxGlitchBurst(el.question, 34, 0.7);
    fxGlitchSweep(0.55);
  }

  function playTimeoutFX() {
    maybePlay(AUDIO.timeup);
    el.app.classList.add("fx-timeup");
    bumpCombo(true);
    fxGlitchBurst(el.question, 22, 0.6);
    fxGlitchSweep(0.6);
  }

  function playCombo5FX() {
    el.app.classList.add("fx-combo5");
    showComboToast("COMBO x5 — OVERDRIVE");
    fxRingAtEl(el.hudCombo, 1.0);
    fxBurstAtEl(el.hudCombo, 95, 14, 0.95);
    fxConfettiSpray(el.hudCombo, 65, 0.9);
    setTimeout(() => el.app.classList.remove("fx-combo5"), 1200);
  }

  function clearFX() {
    el.app.classList.remove("fx-correct", "fx-wrong", "fx-timeup", "fx-warn");
  }

  function bumpCombo(reset) {
    el.hudCombo.classList.remove("punch");
    void el.hudCombo.offsetWidth;
    el.hudCombo.classList.add("punch");
    if (reset) {
      el.hudCombo.classList.add("comboReset");
      setTimeout(() => el.hudCombo.classList.remove("comboReset"), 350);
    }
  }

  function markCorrectAnswer(answerNum) {
    const btns = Array.from(el.choices.querySelectorAll(".choiceBtn"));
    btns.forEach((b, idx) => {
      if (idx + 1 === answerNum) b.classList.add("isCorrect");
      else b.classList.add("isDim");
    });
  }

  // =========================
  // Timer
  // =========================
  function injectMeter() {
    el.meterArea.innerHTML = `
      <div class="meterOuter">
        <div class="meterInner" id="meterInner"></div>
      </div>
      <div class="meterText"><span id="meterSec">${QUESTION_TIME_SEC}</span>s</div>
    `;
  }

  function startTimer() {
    stopTimer();
    state.timer.running = true;
    state.timer.warned = false;
    state.timer.t0 = performance.now();
    state.timer.remainingMs = QUESTION_TIME_SEC * 1000;
    tickTimer();
  }

  function stopTimer() {
    state.timer.running = false;
    if (state.timer.rafId) cancelAnimationFrame(state.timer.rafId);
    state.timer.rafId = 0;
  }

  function tickTimer() {
    if (!state.timer.running) return;

    const now = performance.now();
    const elapsed = now - state.timer.t0;
    const total = QUESTION_TIME_SEC * 1000;
    const remaining = Math.max(0, total - elapsed);
    state.timer.remainingMs = remaining;

    const sec = Math.ceil(remaining / 1000);
    const ratio = remaining / total;

    const meterInner = $id("meterInner");
    const meterSec = $id("meterSec");
    if (meterInner) meterInner.style.transform = `scaleX(${ratio})`;
    if (meterSec) meterSec.textContent = String(sec);

    if (!state.timer.warned && sec <= WARN_AT_SEC) {
      state.timer.warned = true;
      el.app.classList.add("fx-warn");
      maybePlay(AUDIO.tick);
      fxBurstAtEl(el.meterArea, 18, 9, 0.35);
    }

    if (remaining <= 0) {
      stopTimer();
      onTimeout();
      return;
    }

    state.timer.rafId = requestAnimationFrame(tickTimer);
  }

  // =========================
  // Overlay + Countdown
  // =========================
  function showOverlay(card, rarity) {
    el.overlay.classList.remove("hidden");

    if (!card) {
      el.cardArea.classList.add("hidden");
      el.resultTitle.textContent = "FAILED";
      el.resultTitle.classList.add("failed");
      return;
    }

    el.resultTitle.textContent = rarity === 5 ? "PERFECT REWARD" : "CLEAR REWARD";
    el.resultTitle.classList.remove("failed");

    el.cardArea.classList.remove("hidden");
    el.cardImg.src = card.img;
    el.cardName.textContent = `★${card.rarity} ${card.name}`;

    if (card.wiki) {
      el.cardWiki.href = card.wiki;
      el.cardWiki.style.display = "inline-block";
    } else {
      el.cardWiki.style.display = "none";
    }
  }

  function hideOverlay() {
    el.overlay.classList.add("hidden");
  }

  function showCountdown(onDone) {
    const seq = ["3", "2", "1", "GO"];
    el.countdown.classList.remove("hidden");

    let i = 0;
    const step = () => {
      if (i >= seq.length) {
        el.countdown.classList.add("hidden");
        onDone?.();
        return;
      }
      el.countdown.textContent = seq[i];
      el.countdown.classList.remove("pop");
      void el.countdown.offsetWidth;
      el.countdown.classList.add("pop");
      i += 1;
      setTimeout(step, 520);
    };
    step();
  }

  // =========================
  // Highlight
  // =========================
  function renderHighlighted(s) {
    const escaped = escapeHtml(s);
    return escaped
      .replace(/【(.*?)】/g, `<span class="hl">【$1】</span>`)
      .replace(/〖(.*?)〗/g, `<span class="hl">〖$1〗</span>`);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // =========================
  // CSV normalize
  // =========================
  function normalizeQuestionRow(row) {
    const id = clean(row.id);
    const question = clean(row.question);
    if (!id || !question) return null;

    const source = clean(row.source);
    const choices = [row.choice1, row.choice2, row.choice3, row.choice4].map(clean);
    if (choices.some((c) => !c)) return null;

    const ans = parseInt(clean(row.answer), 10);
    if (![1, 2, 3, 4].includes(ans)) return null;

    return { id, question, source, choices, answer: ans };
  }

  function normalizeCardRow(row) {
    const id = clean(row.id);
    const rarity = parseInt(clean(row.rarity), 10);
    const name = clean(row.name);
    const img = clean(row.img);
    const wiki = clean(row.wiki);
    const weight = parseFloat(clean(row.weight)) || 1;

    if (!id || !name || !img) return null;
    if (![3, 4, 5].includes(rarity)) return null;

    return { id, rarity, name, img, wiki, weight: Math.max(0.0001, weight) };
  }

  // =========================
  // Storage
  // =========================
  function readCounts() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeCounts(obj) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(obj));
    } catch {}
  }

  // =========================
  // Utils
  // =========================
  function clean(v) {
    return String(v ?? "").trim();
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickRandomQuestions(all, n) {
    const copy = all.slice();
    shuffleInPlace(copy);
    return copy.slice(0, n);
  }

  function weightedPick(items) {
    let sum = 0;
    for (const it of items) sum += it.weight;

    let r = Math.random() * sum;
    for (const it of items) {
      r -= it.weight;
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  function hardFail(msg) {
    el.question.textContent = msg;
    el.source.textContent = "";
    el.choices.innerHTML = "";
    el.note.textContent = "配置/CSVヘッダ/パスを確認してください";
    el.app.classList.add("fatal");
    stopTimer();
  }

  function unlockAudio() {
    state.audioUnlocked = true;
    el.note.textContent = "音：ON";

    try {
      AUDIO.bgm.loop = true;
      AUDIO.bgm.volume = 0.35;

      AUDIO.bgm.play()
        .then(() => {
          AUDIO.bgm.pause();
          AUDIO.bgm.currentTime = 0;
          AUDIO.bgm.play().catch(() => {});
        })
        .catch(() => {
          el.note.textContent = "音：ブラウザ制限で自動再生不可（タップ後に開始します）";
        });
    } catch {
      el.note.textContent = "音：初期化失敗";
    }
  }

  function maybePlay(audio) {
    if (!audio) return;
    try {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {}
  }

  // =========================
  // Canvas Particle FX  ✅ fixed: no dark overlay accumulation
  // =========================
  function injectFXLayer() {
    const canvas = document.createElement("canvas");
    canvas.id = "fxCanvas";
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "40";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d", { alpha: true });
    state.fx.canvas = canvas;
    state.fx.ctx = ctx;

    const toast = document.createElement("div");
    toast.id = "comboToast";
    toast.className = "comboToast hidden";
    toast.textContent = "COMBO x5 — OVERDRIVE";
    document.body.appendChild(toast);

    window.addEventListener("resize", () => resizeFX(), { passive: true });
    resizeFX();
    fxStartLoop();
  }

  function resizeFX() {
    const c = state.fx.canvas;
    const dpr = (state.fx.dpr = Math.min(2, window.devicePixelRatio || 1));
    const w = (state.fx.w = Math.floor(window.innerWidth));
    const h = (state.fx.h = Math.floor(window.innerHeight));
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = w + "px";
    c.style.height = h + "px";
    state.fx.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxClearAll();
  }

  function fxStartLoop() {
    if (state.fx.raf) cancelAnimationFrame(state.fx.raf);
    state.fx.lastTs = performance.now();
    const loop = (ts) => {
      const dt = Math.min(0.033, (ts - state.fx.lastTs) / 1000);
      state.fx.lastTs = ts;
      fxTick(dt);
      state.fx.raf = requestAnimationFrame(loop);
    };
    state.fx.raf = requestAnimationFrame(loop);
  }

  function fxTick(dt) {
    const ctx = state.fx.ctx;
    if (!ctx) return;

    const w = state.fx.w;
    const h = state.fx.h;

    // ✅ IMPORTANT:
    // Fade previous particles without painting black over the page.
    // destination-out reduces alpha, keeping background visible.
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    // dt normalized; ~60fps => dt≈0.016. this makes a stable fade.
    const fade = Math.min(0.35, 0.12 + dt * 6.0);
    ctx.fillStyle = `rgba(0,0,0,${fade})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const ps = state.fx.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      p.vx *= (1 - 0.8 * dt);
      p.vy *= (1 - 0.8 * dt);

      const a = Math.max(0, Math.min(1, p.life / p.maxLife)) * p.alpha;

      ctx.save();
      ctx.globalCompositeOperation = p.mode;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (ps.length > 1400) ps.splice(0, ps.length - 1400);
  }

  function fxClearAll() {
    state.fx.particles.length = 0;
    const ctx = state.fx.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, state.fx.w, state.fx.h);
  }

  function centerOfEl(node) {
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function fxBurstAtEl(node, count, speed, intensity) {
    const { x, y } = centerOfEl(node);
    fxBurst(x, y, count, speed, intensity);
  }
  function fxRingAtEl(node, intensity) {
    const { x, y } = centerOfEl(node);
    fxRing(x, y, intensity);
  }
  function fxBurstAtCenter(count, speed, intensity) {
    fxBurst(state.fx.w / 2, state.fx.h / 2, count, speed, intensity);
  }
  function fxRingAtCenter(intensity) {
    fxRing(state.fx.w / 2, state.fx.h / 2, intensity);
  }
  function fxGlitchBurst(node, count, intensity) {
    const { x, y } = centerOfEl(node);
    fxGlitch(x, y, count, intensity);
  }

  function fxGlitchSweep(intensity) {
    const y = (Math.random() * 0.5 + 0.25) * state.fx.h;
    const n = Math.floor(80 * (0.6 + intensity));
    for (let i = 0; i < n; i++) {
      const x = Math.random() * state.fx.w;
      spawnParticle({
        x,
        y: y + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 120,
        vy: (Math.random() - 0.5) * 40,
        ax: 0,
        ay: 0,
        r: 1.2 + Math.random() * 1.8,
        life: 0.25 + Math.random() * 0.25,
        alpha: 0.55 + 0.25 * intensity,
        color: "rgba(255,45,85,1)",
        mode: "screen",
      });
    }
  }

  function fxConfettiSpray(node, count, intensity) {
    const { x, y } = centerOfEl(node);
    const n = Math.floor(count);
    for (let i = 0; i < n; i++) {
      const ang = (-Math.PI / 2) + (Math.random() - 0.5) * 1.1;
      const sp = (180 + Math.random() * 220) * (0.6 + intensity);
      const vx = Math.cos(ang) * sp;
      const vy = Math.sin(ang) * sp;
      const pick = Math.random();
      const color =
        pick < 0.45 ? "rgba(0,229,255,1)" :
        pick < 0.80 ? "rgba(255,45,85,1)" :
        "rgba(255,204,0,1)";
      spawnParticle({
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.2) * 18,
        vx, vy,
        ax: 0,
        ay: 520,
        r: 1.6 + Math.random() * 2.6,
        life: 0.55 + Math.random() * 0.35,
        alpha: 0.65,
        color,
        mode: "screen",
      });
    }
  }

  function fxBurst(x, y, count, speed, intensity) {
    const n = Math.floor(count);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 180) * (speed / 10) * (0.6 + intensity);
      const vx = Math.cos(a) * sp;
      const vy = Math.sin(a) * sp;
      const pick = Math.random();
      const color =
        pick < 0.50 ? "rgba(0,229,255,1)" :
        pick < 0.85 ? "rgba(255,45,85,1)" :
        "rgba(255,204,0,1)";
      spawnParticle({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx, vy,
        ax: 0,
        ay: 240,
        r: 1.8 + Math.random() * 3.2,
        life: 0.45 + Math.random() * 0.45,
        alpha: 0.75,
        color,
        mode: "screen",
      });
    }
  }

  function fxRing(x, y, intensity) {
    const n = Math.floor(90 * (0.6 + intensity));
    const base = 220 * (0.6 + intensity);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = base * (0.8 + Math.random() * 0.35);
      spawnParticle({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        ax: 0,
        ay: 0,
        r: 1.2 + Math.random() * 1.8,
        life: 0.35 + Math.random() * 0.25,
        alpha: 0.55 + 0.25 * intensity,
        color: "rgba(0,229,255,1)",
        mode: "screen",
      });
    }
  }

  function fxGlitch(x, y, count, intensity) {
    const n = Math.floor(count);
    for (let i = 0; i < n; i++) {
      const a = (Math.random() - 0.5) * 0.8;
      const sp = (140 + Math.random() * 260) * (0.55 + intensity);
      const vx = Math.cos(a) * sp;
      const vy = (Math.random() - 0.5) * 60;
      spawnParticle({
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 18,
        vx, vy,
        ax: 0,
        ay: 0,
        r: 1.4 + Math.random() * 2.4,
        life: 0.25 + Math.random() * 0.25,
        alpha: 0.65,
        color: "rgba(255,45,85,1)",
        mode: "screen",
      });
    }
  }

  function spawnParticle(p) {
    state.fx.particles.push({
      x: p.x, y: p.y,
      vx: p.vx, vy: p.vy,
      ax: p.ax, ay: p.ay,
      r: p.r,
      life: p.life,
      maxLife: p.life,
      alpha: p.alpha,
      color: p.color,
      mode: p.mode || "lighter",
    });
  }

  // =========================
  // Combo toast
  // =========================
  function showComboToast(text) {
    const t = $id("comboToast");
    if (!t) return;
    t.textContent = text;
    t.classList.remove("hidden");
    t.classList.remove("show");
    void t.offsetWidth;
    t.classList.add("show");
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.classList.add("hidden"), 420);
    }, 900);
  }
})();
