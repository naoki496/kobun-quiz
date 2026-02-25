/* EXPERT mode (isolated)
 * - 30 questions
 * - 10 sec each
 * - timeout = wrong (combo breaks)
 * - Reward rules:
 *   ★5 guaranteed: correct >= 25 AND maxCombo >= 5
 *   ★4 guaranteed: correct 20..24
 *   else: no reward (★3 never appears)
 * - Card counts saved to localStorage key: hklobby.v1.cardCounts
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
    bgm: new Audio("./assets/bgm.mp3"),
    correct: new Audio("./assets/correct.mp3"),
    wrong: new Audio("./assets/wrong.mp3"),
    go: new Audio("./assets/go.mp3"),
    tick: null,   // optional (no asset)
    timeup: null, // optional (no asset)
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

    const params = new URLSearchParams(location.search);
    state.autostart = params.get("start") === "1";

    // Unlock audio (mobile autoplay restriction)
    document.addEventListener("pointerdown", () => {
      if (!state.audioUnlocked) unlockAudio();
    });

    el.btnRetry.addEventListener("click", () => startNewRun(true));
    el.btnAgain.addEventListener("click", () => startNewRun(true));

    // Load CSV
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

    // Validate
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
    stopTimer();
    clearFX();
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
    if (state.qIndex >= TOTAL_QUESTIONS) {
      finishRun();
    } else {
      startQuestion();
    }
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
      return;
    }
    if (rarity === 4) {
      el.rReward.textContent = "★4 確定（20〜24）";
      const card = rollCardByRarity(4);
      grantCard(card);
      showOverlay(card, 4);
      return;
    }

    el.rReward.textContent = "報酬なし（★3は出ません）";
    showOverlay(null, null);
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
  // FX
  // =========================
  function playCorrectFX() {
    maybePlay(AUDIO.correct);
    el.app.classList.add("fx-correct");
    bumpCombo(false);
  }

  function playWrongFX() {
    maybePlay(AUDIO.wrong);
    el.app.classList.add("fx-wrong");
    bumpCombo(true);
  }

  function playTimeoutFX() {
    maybePlay(AUDIO.timeup);
    el.app.classList.add("fx-timeup");
    bumpCombo(true);
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
    } catch {
      // ignore
    }
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

  function renderHighlighted(s) {
    const escaped = escapeHtml(s);
    return escaped.replace(/〖(.*?)〗/g, `<span class="hl">〖$1〗</span>`);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    // Try to unlock on mobile. Keep it resilient.
    state.audioUnlocked = true;
    el.note.textContent = "音：ON";

    try {
      AUDIO.bgm.loop = true;
      AUDIO.bgm.volume = 0.35;

      // Unlock by quick play/pause, then start.
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
    } catch {
      // ignore
    }
  }
})();
