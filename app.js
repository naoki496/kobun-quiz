// app.js (global) - GAME UI meter / glow / flash / shake

const TOTAL_QUESTIONS = 10;

let questions = [];
let order = [];
let index = 0;
let score = 0;
let locked = false;

// Combo
let combo = 0;
let maxCombo = 0;

// UI refs
const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const questionEl = document.getElementById("question");
const statusEl = document.getElementById("status");
const choiceBtns = Array.from(document.querySelectorAll(".choice"));
const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

// Flash overlay
const flashEl = document.getElementById("flash");

// ====== Meter DOM (created in JS, styled by CSS) ======
let meterWrapEl, meterTextEl, meterBarOuterEl, meterFillEl;

// 状態クラスを付与する先（quiz全体 or bodyでもOK）
const rootEl = document.getElementById("quiz") || document.body;

function ensureMeter() {
  if (meterWrapEl) return;

  meterWrapEl = document.createElement("div");
  meterWrapEl.id = "meterWrap";

  meterTextEl = document.createElement("div");
  meterTextEl.id = "meterText";

  meterBarOuterEl = document.createElement("div");
  meterBarOuterEl.id = "meterBarOuter";

  meterFillEl = document.createElement("div");
  meterFillEl.id = "meterFill";

  meterBarOuterEl.appendChild(meterFillEl);
  meterWrapEl.appendChild(meterTextEl);
  meterWrapEl.appendChild(meterBarOuterEl);

  // 既存UIの中で、progress/scoreの下に挿入
  const meta = document.getElementById("meta");
  if (meta && meta.parentNode) {
    meta.parentNode.insertBefore(meterWrapEl, meta.nextSibling);
  } else {
    // フォールバック
    document.body.insertBefore(meterWrapEl, document.body.firstChild);
  }

  // 初期表示
  meterTextEl.textContent = "";
  meterFillEl.style.width = "0%";
}

function setMeterState(state) {
  // state: "good" | "bad" | "neutral"
  rootEl.classList.remove("meter--good", "meter--bad");
  if (state === "good") rootEl.classList.add("meter--good");
  if (state === "bad") rootEl.classList.add("meter--bad");
}

function setComboState(isCombo) {
  rootEl.classList.toggle("meter--combo", !!isCombo);
}

function updateMeterUI() {
  ensureMeter();

  const total = order.length || TOTAL_QUESTIONS;
  const done = Math.min(index, total); // 現在の index は「表示中の問題番号 - 1」なので、進捗は index を基準
  const pct = total ? Math.round((done / total) * 100) : 0;

  meterTextEl.textContent =
    `進捗 ${done}/${total}（${pct}%） / 最大COMBO x${maxCombo}`;

  meterFillEl.style.width = `${pct}%`;

  // コンボ2以上で発光・脈動
  setComboState(combo >= 2);
}

function flash(type) {
  if (!flashEl) return;
  flashEl.className = ""; // reset
  flashEl.classList.add(type === "good" ? "flash--good" : "flash--bad");
  flashEl.style.opacity = "1";

  // すぐ消える（短く強い方が「ゲーム感」）
  setTimeout(() => {
    flashEl.style.opacity = "0";
  }, 120);
}

function shakeRoot() {
  rootEl.classList.remove("shake");
  // reflow to restart animation
  void rootEl.offsetWidth;
  rootEl.classList.add("shake");
}

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

function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();

  // 出典は軽く埋め込み
  questionEl.textContent = q.source ? `${q.question}（${q.source}）` : q.question;

  choiceBtns.forEach((btn, i) => {
    btn.textContent = q.choices[i] || "---";
    btn.classList.remove("correct", "wrong");
    btn.disabled = false;
  });

  statusEl.textContent = "";
  nextBtn.disabled = true;
  locked = false;

  // メーター更新：この時点の進捗（表示中は未回答なので index をそのまま）
  setMeterState("neutral");
  updateMeterUI();
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

  ensureMeter();
  setMeterState("neutral");
  setComboState(false);
  updateMeterUI();
  render();
}

function finish() {
  progressEl.textContent = "終了";
  questionEl.textContent = `結果：${score} / ${order.length}`;
  statusEl.textContent = `おつかれさまでした。最大COMBO x${maxCombo}`;
  disableChoices(true);
  nextBtn.disabled = true;

  // 100%にして締め
  index = order.length;
  setMeterState("neutral");
  updateMeterUI();
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

    // 演出（正解）
    setMeterState("good");
    flash("good");
  } else {
    combo = 0;

    choiceBtns[selectedIdx].classList.add("wrong");
    choiceBtns[correctIdx].classList.add("correct");
    updateStatusUI("不正解");

    // 演出（不正解）
    setMeterState("bad");
    flash("bad");
    shakeRoot();
  }

  updateScoreUI();

  // ※自動遷移はOFF：次へボタンで進む
  nextBtn.disabled = false;

  // 進捗は「解答した」時点で +1 進めたいので、メーター更新だけ先に反映
  // 表示上の done を index+1 相当へ寄せるため、一時的に index を使わず計算するなら別関数でもOK
  // ここでは「回答済み」を反映したいので、meterTextの done を index+1 で表示する
  const total = order.length || TOTAL_QUESTIONS;
  const done = Math.min(index + 1, total);
  const pct = total ? Math.round((done / total) * 100) : 0;
  meterTextEl.textContent = `進捗 ${done}/${total}（${pct}%） / 最大COMBO x${maxCombo}`;
  meterFillEl.style.width = `${pct}%`;

  // コンボ状態更新
  setComboState(combo >= 2);
}

choiceBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const idx = Number(btn.dataset.idx);
    judge(idx);
  });
});

nextBtn.addEventListener("click", () => {
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
}

(async function boot() {
  try {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = `読み込み中…`;
    statusEl.textContent = "";

    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);

    start();
  } catch (e) {
    showError(e);
  }
})();
