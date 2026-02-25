/* expert.js (kobun-quiz EXPERT)
 * - Independent from app.js
 * - Uses csv.js: window.CSVUtil.load(url)
 * - Pre-start modal + START button (alarm FX + fade out)
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
    timeup: new Audio("./assets/wrongex.mp3"), // 指定どおり
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
  // Canvas FX (behind content)
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
  fxCanvas.style.zIndex = "0"; // behind content
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

  function fxTick() {
    fxT += 1;

    // fade out previous frame (destination-out)
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
    ctx.restore();

    // warning scanlines (calmer / less bright)
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

    // ===== scan lines: lower brightness
    const step = mode === "exit" ? 7 : 11;
    ctx.fillStyle = mode === "exit" ? "rgba(255,45,85,0.06)" : "rgba(255,45,85,0.045)";
    for (let y = 0; y < h; y += step) {
      ctx.fillRect(0, y, w, 2);
    }

    // ===== sweep band: lower alpha
    const bandH = mode === "exit" ? 170 : 135;
    const speed = mode === "exit" ? 11 : 8;
    const bandY = (fxT * speed) % (h + bandH) - bandH;

    const grad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
    grad.addColorStop(0, "rgba(255,45,85,0)");
    grad.addColorStop(0.45, mode === "exit" ? "rgba(255,45,85,0.18)" : "rgba(255,45,85,0.14)");
    grad.addColorStop(0.55, mode === "exit" ? "rgba(255,45,85,0.18)" : "rgba(255,45,85,0.14)");
    grad.addColorStop(1, "rgba(255,45,85,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, bandY, w, bandH);

    // ===== noise blocks: fewer + dimmer
    const n = mode === "exit" ? 90 : 45;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const rw = 10 + Math.random() * (mode === "exit" ? 40 : 22);
      const rh = 1 + Math.random
