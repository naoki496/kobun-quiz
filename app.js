// app.js (global)

const TOTAL_QUESTIONS = 10;

let questions = [];
let order = [];
let index = 0;
let score = 0;
let locked = false;

// Combo
let combo = 0;
let maxCombo = 0;

const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const questionEl = document.getElementById("question");
const statusEl = document.getElementById("status");
const choiceBtns = Array.from(document.querySelectorAll(".choice"));
const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

// Combo / Flash elements
const comboFxEl = document.getElementById("comboFx");
const flashEl = document.getElementById("flash");

// Sound button
const soundBtn = document.getElementById("soundBtn");

/* =========================
   Sound (SE) - low latency
   ========================= */
const Sound = (() => {
  const SE_CORRECT = "./assets/correct.mp3";
  const SE_WRONG   = "./assets/wrong.mp3";

  let enabled = true;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = AudioCtx ? new AudioCtx() : null;

  let bufCorrect = null;
  let bufWrong = null;
  let loaded = false;
  let volume = 0.7;

  function setEnabled(v) { enabled = !!v; }
  function isEnabled() { return enabled; }
  function setVolume(v) {
    const nv = Number(v);
    if (!Number.isFinite(nv)) return;
    volume = Math.max(0, Math.min(1, nv));
  }

  async function unlock() {
    if (ctx && ctx.state === "suspended") {
      try { await ctx.resume(); } catch (_) {}
    }
  }

  async function load() {
    if (!ctx) { loaded = false; return; }
    if (loaded) return;

    const [a, b] = await Promise.all([
      fetch(SE_CORRECT, { cache: "no-store" }).then(r => {
        if (!r.ok) throw new Error(`SE fetch failed: correct (${r.status})`);
        return r.arrayBuffer();
      }),
      fetch(SE_WRONG, { cache: "no-store" }).then(r => {
        if (!r.ok) throw new Error(`SE fetch failed: wrong (${r.status})`);
        return r.arrayBuffer();
      })
    ]);

    bufCorrect = await ctx.decodeAudioData(a.slice(0));
    bufWrong   = await ctx.decodeAudioData(b.slice(0));
    loaded = true;
  }

  function playBuffer(buffer) {
    if (!ctx || !loaded || !enabled || !buffer) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = volume;

    src.connect(gain);
    gain.connect(ctx.destination);

    try { src.start(0); } catch (_) {}
  }

  function correct() { playBuffer(bufCorrect); }
  function wrong()   { playBuffer(bufWrong); }

  return { load, unlock, correct, wrong, setEnabled, isEnabled, setVolume };
})();
/* =========================
   /Sound
   ========================= */

function disableChoices(disabled) {
  choiceBtns.forEach(b => (b.disabled = disabled));
}

function shuffle(arr) {
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeRow(r) {
  const ans = Number(String(r.answer ?? "").trim());
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
      String(r.choice4 ?? "")
    ],
    answer: ans
  };
}

function updateScoreUI() {
  scoreEl.textContent = `Score: ${score}`;
}

function updateStatusUI(message) {
  const comboText = combo >= 2 ? ` / COMBO x${combo}` : "";
  statusEl.textContent = `${message}${comboText}`;
}

/* ===== Combo + Flash FX (enhanced) ===== */
function flash(kind) {
  if (!flashEl) return;
  flashEl.classList.remove("ok", "ng");
  // reflow
  void flashEl.offsetWidth;
  flashEl.classList.add(kind);
}

function hideComboFx(quick = false) {
  if (!comboFxEl) return;
  if (quick) comboFxEl.classList.add("fade");
  comboFxEl.classList.remove("show", "pop", "max");
  comboFxEl.textContent = "";
}

function showComboFx(isNewMax) {
  if (!comboFxEl) return;

  if (combo >= 2) {
    comboFxEl.textContent = `COMBO x${combo}`;
    comboFxEl.classList.add("show");

    comboFxEl.classList.toggle("max", !!isNewMax);

    comboFxEl.classList.remove("pop");
    void comboFxEl.offsetWidth;
    comboFxEl.classList.add("pop");

    comboFxEl.classList.remove("fade");
  } else {
    hideComboFx(true);
  }
}

function hitButton(btn) {
  if (!btn) return;
  btn.classList.remove("hit");
  void btn.offsetWidth;
  btn.classList.add("hit");
}

function shakeButton(btn) {
  if (!btn) return;
  btn.classList.remove("shake");
  void btn.offsetWidth;
  btn.classList.add("shake");
}
/* ===== /Combo + Flash FX ===== */

function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();

  questionEl.textContent = q.source ? `${q.question}（${q.source}）` : q.question;

  choiceBtns.forEach((btn, i) => {
    btn.textContent = q.choices[i] || "---";
    btn.classList.remove("correct", "wrong", "hit", "shake");
    btn.disabled = false;
  });

  statusEl.textContent = "";
  nextBtn.disabled = true;
  locked = false;

  hideComboFx(true);
}

function start() {
  score = 0;
  index = 0;

  combo = 0;
  maxCombo = 0;

  const pool = shuffle([...questions]);
  order = pool.slice(0, Math.min(TOTAL_QUESTIONS, pool.length));

  if (!order.length) {
    throw new Error("問題が0件です（CSVの内容を確認してください）");
  }

  hideComboFx(true);
  render();
}

function finish() {
  progressEl.textContent = "終了";
  questionEl.textContent = `結果：${score} / ${order.length}`;
  statusEl.textContent = `おつかれさまでした。最大COMBO x${maxCombo}`;
  disableChoices(true);
  nextBtn.disabled = true;
  hideComboFx(true);
}

function judge(selectedIdx) {
  if (locked) return;
  locked = true;
  disableChoices(true);

  const q = order[index];
  const correctIdx = q.answer - 1;

  if (selectedIdx === correctIdx) {
    score++;

    combo++;
    const isNewMax = combo > maxCombo;
    if (isNewMax) maxCombo = combo;

    const btn = choiceBtns[selectedIdx];
    btn.classList.add("correct");
    hitButton(btn);

    updateStatusUI(isNewMax ? "正解（MAX更新）" : "正解");

    // SE + Flash + Combo FX
    Sound.correct();
    flash("ok");
    showComboFx(isNewMax);
  } else {
    combo = 0;

    const btn = choiceBtns[selectedIdx];
    btn.classList.add("wrong");
    shakeButton(btn);

    choiceBtns[correctIdx].classList.add("correct");
    updateStatusUI("不正解");

    // SE + Flash + Combo FX
    Sound.wrong();
    flash("ng");
    hideComboFx(true);
  }

  updateScoreUI();

  // 自動遷移OFF：次へボタンを有効化するだけ
  nextBtn.disabled = false;
}

choiceBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await Sound.unlock(); // iOS対策
    const idx = Number(btn.dataset.idx);
    judge(idx);
  });
});

nextBtn.addEventListener("click", async () => {
  await Sound.unlock();
  if (!locked) return;

  index++;
  if (index >= order.length) {
    finish();
  } else {
    render();
  }
});

restartBtn.addEventListener("click", async () => {
  await Sound.unlock();
  try {
    start();
  } catch (e) {
    showError(e);
  }
});

function showError(err) {
  console.error(err);
  progressEl.textContent = "読み込み失敗";
  scoreEl.textContent = "Score: 0";
  questionEl.textContent = "CSVを読み込めませんでした。";
  statusEl.textContent = `詳細: ${err?.message ?? err}`;
  disableChoices(true);
  nextBtn.disabled = true;
  hideComboFx(true);
}

// SE ON/OFF
if (soundBtn) {
  soundBtn.addEventListener("click", async () => {
    await Sound.unlock();
    const next = !Sound.isEnabled();
    Sound.setEnabled(next);
    soundBtn.setAttribute("aria-pressed", String(next));
    soundBtn.textContent = next ? "🔊 SE" : "🔇 SE";
  });
}

(async function boot() {
  try {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    // SE先読み（失敗してもゲームは動かす）
    try {
      await Sound.load();
    } catch (e) {
      console.warn("SE load failed:", e);
      if (soundBtn) {
        soundBtn.setAttribute("aria-pressed", "false");
        soundBtn.textContent = "🔇 SE";
      }
      Sound.setEnabled(false);
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = `読み込み中… (${csvUrl})`;

    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);

    start();
  } catch (e) {
    showError(e);
  }
})();
