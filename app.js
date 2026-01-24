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

// optional buttons
const soundBtn = document.getElementById("soundBtn");
const bgmBtn = document.getElementById("bgmBtn");

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
  // answer は "1"～"4" 想定（CSV: id,question,source,choice1..4,answer）
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

/* =========================
   SE (Sound Effects)
   ========================= */
const Sound = (() => {
  // ファイルは必要に応じて差し替え
  const correct = new Audio("./assets/correct.mp3");
  const wrong = new Audio("./assets/wrong.mp3");

  let unlocked = false;
  let enabled = true;

  function setEnabled(v) { enabled = !!v; }
  function isEnabled() { return enabled; }

  async function unlock() {
    if (unlocked) return;
    try {
      // iOS/Safari対策：ユーザー操作で“音”を一度解錠
      correct.muted = true;
      await correct.play();
      correct.pause();
      correct.currentTime = 0;
      correct.muted = false;

      wrong.muted = true;
      await wrong.play();
      wrong.pause();
      wrong.currentTime = 0;
      wrong.muted = false;

      unlocked = true;
    } catch (e) {
      unlocked = true;
    }
  }

  async function playCorrect() {
    if (!enabled) return;
    try {
      correct.currentTime = 0;
      await correct.play();
    } catch (e) {}
  }

  async function playWrong() {
    if (!enabled) return;
    try {
      wrong.currentTime = 0;
      await wrong.play();
    } catch (e) {}
  }

  return { unlock, playCorrect, playWrong, setEnabled, isEnabled };
})();

/* =========================
   BGM (Explicit ON only)
   ========================= */
const BGM = (() => {
  const audio = new Audio("./assets/bgm.mp3");
  audio.loop = true;
  audio.volume = 0.25;

  let enabled = false; // ★初期OFF（明示ONの人だけ）

  async function play() {
    enabled = true;
    try {
      await audio.play();
    } catch (e) {
      // autoplay制限：ユーザーの“ボタン操作”で呼ばれるので通常はOK
      console.warn("BGM play blocked:", e);
      enabled = false;
    }
  }

  function stop() {
    enabled = false;
    audio.pause();
    audio.currentTime = 0;
  }

  async function toggle() {
    if (enabled) stop();
    else await play();
  }

  function isEnabled() { return enabled; }

  return { play, stop, toggle, isEnabled };
})();

function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();

  questionEl.textContent = q.source ? `${q.question}（${q.source}）` : q.question;

  choiceBtns.forEach((btn, i) => {
    btn.textContent = q.choices[i] || "---";
    btn.classList.remove("correct", "wrong");
    btn.disabled = false;
  });

  statusEl.textContent = "";
  nextBtn.disabled = true;
  locked = false;
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

  render();
}

function finish() {
  progressEl.textContent = "終了";
  questionEl.textContent = `結果：${score} / ${order.length}`;
  statusEl.textContent = `おつかれさまでした。最大COMBO x${maxCombo}`;
  disableChoices(true);
  nextBtn.disabled = true;
}

async function judge(selectedIdx) {
  if (locked) return;
  locked = true;

  // 最初のユーザー操作で音の解錠（SE/BGM共通の前提作り）
  await Sound.unlock();

  disableChoices(true);

  const q = order[index];
  const correctIdx = q.answer - 1;

  if (selectedIdx === correctIdx) {
    score++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;

    choiceBtns[selectedIdx].classList.add("correct");
    updateStatusUI("正解");
    Sound.playCorrect();
  } else {
    combo = 0;

    choiceBtns[selectedIdx].classList.add("wrong");
    choiceBtns[correctIdx].classList.add("correct");
    updateStatusUI("不正解");
    Sound.playWrong();
  }

  updateScoreUI();

  // ★自動遷移OFF：次へボタンを押したら進む
  nextBtn.disabled = false;
}

choiceBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const idx = Number(btn.dataset.idx);
    judge(idx);
  });
});

nextBtn.addEventListener("click", () => {
  index++;
  if (index >= order.length) finish();
  else render();
});

restartBtn.addEventListener("click", () => {
  try {
    start();
  } catch (e) {
    showError(e);
  }
});

// SEボタン（ON/OFF）
if (soundBtn) {
  soundBtn.addEventListener("pointerup", async (e) => {
    e.preventDefault();
    await Sound.unlock();

    const on = !Sound.isEnabled();
    Sound.setEnabled(on);

    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.textContent = on ? "🔊 SE" : "🔇 SE";
  }, { passive: false });
}

// BGMボタン（明示ON/OFF）
if (bgmBtn) {
  bgmBtn.addEventListener("pointerup", async (e) => {
    e.preventDefault();

    // ボタン操作 = ユーザー操作なので、ここで確実に解錠
    await Sound.unlock();

    await BGM.toggle();

    const on = BGM.isEnabled();
    bgmBtn.setAttribute("aria-pressed", String(on));
    bgmBtn.textContent = on ? "🎵 BGM" : "🎵 OFF";
  }, { passive: false });
}

function showError(err) {
  console.error(err);
  progressEl.textContent = "読み込み失敗";
  scoreEl.textContent = "Score: 0";
  questionEl.textContent = "CSVを読み込めませんでした。";
  statusEl.textContent = `詳細: ${err?.message ?? err}`;
  disableChoices(true);
  nextBtn.disabled = true;
}

(async function boot() {
  try {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = "読み込み中…";

    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);

    start();
  } catch (e) {
    showError(e);
  }
})();
