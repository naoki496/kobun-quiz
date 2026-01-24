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
const comboFxEl = document.getElementById("comboFx");

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
  // answer は "1"～"4" 想定（CSVの列名は id question source choice1..4 answer）
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
  // コンボ表示を統一的にここで処理（テキスト側）
  const comboText = combo >= 2 ? ` / COMBO x${combo}` : "";
  statusEl.textContent = `${message}${comboText}`;
}

/* ===== Combo FX (badge) ===== */
function showComboFx() {
  if (!comboFxEl) return;

  // combo>=2 の時だけ表示（1は出すと煩雑）
  if (combo >= 2) {
    comboFxEl.textContent = `COMBO x${combo}`;
    comboFxEl.classList.add("show");

    // アニメを確実に再生させる（class付け直し）
    comboFxEl.classList.remove("pop");
    void comboFxEl.offsetWidth; // reflow
    comboFxEl.classList.add("pop");

    // 伸びたら軽く強調
    if (combo >= 5) comboFxEl.classList.add("power");
    else comboFxEl.classList.remove("power");

    comboFxEl.classList.remove("fade");
  } else {
    hideComboFx(true);
  }
}

function hideComboFx(quick = false) {
  if (!comboFxEl) return;

  if (quick) {
    comboFxEl.classList.add("fade");
  }
  comboFxEl.classList.remove("show", "pop", "power");
  comboFxEl.textContent = "";
}
/* ===== /Combo FX ===== */

function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();

  // 表示（出典は問題文に軽く埋める。必要なら別表示にもできます）
  questionEl.textContent = q.source ? `${q.question}（${q.source}）` : q.question;

  choiceBtns.forEach((btn, i) => {
    btn.textContent = q.choices[i] || "---";
    btn.classList.remove("correct", "wrong");
    btn.disabled = false;
  });

  // 状態初期化
  statusEl.textContent = "";
  nextBtn.disabled = true;
  locked = false;

  // 次問に入ったらFXは一旦消す（テンポの邪魔をしない）
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
  // 終了時も邪魔なので消す
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
    if (combo > maxCombo) maxCombo = combo;

    choiceBtns[selectedIdx].classList.add("correct");
    updateStatusUI("正解");

    // コンボ演出（バッジ）
    showComboFx();
  } else {
    combo = 0;

    choiceBtns[selectedIdx].classList.add("wrong");
    choiceBtns[correctIdx].classList.add("correct");
    updateStatusUI("不正解");

    // 不正解時は即消す
    hideComboFx(true);
  }

  updateScoreUI();

  // 自動遷移OFF：ここでは進めず、次へボタンを有効化するだけ
  nextBtn.disabled = false;
}

choiceBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const idx = Number(btn.dataset.idx);
    judge(idx);
  });
});

nextBtn.addEventListener("click", () => {
  // 未回答なのに押されるのは無効（保険）
  if (!locked) return;

  index++;
  if (index >= order.length) {
    finish();
  } else {
    render();
  }
});

restartBtn.addEventListener("click", () => {
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

(async function boot() {
  try {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = `読み込み中… (${csvUrl})`;

    const raw = await window.CSVUtil.load(csvUrl);

    // 正規化（ここで変なデータがあると理由付きで落ちる）
    questions = raw.map(normalizeRow);

    start();
  } catch (e) {
    showError(e);
  }
})();
