const TOTAL_QUESTIONS = 10;

let questions = [];
let order = [];
let index = 0;
let correct = 0;
let answered = false;

const qEl = document.getElementById("question");
const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");
const choiceBtns = Array.from(document.querySelectorAll(".choice"));

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setButtonsEnabled(enabled) {
  choiceBtns.forEach(b => (b.disabled = !enabled));
}

function clearChoiceStyles() {
  choiceBtns.forEach(b => {
    b.classList.remove("correct", "wrong");
  });
}

function start() {
  if (!questions.length) return;

  order = shuffle([...questions]).slice(0, Math.min(TOTAL_QUESTIONS, questions.length));
  index = 0;
  correct = 0;
  answered = false;

  scoreEl.textContent = `Score: ${correct}`;
  statusEl.textContent = "";
  nextBtn.disabled = true;

  show();
}

function show() {
  const q = order[index];
  answered = false;

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  scoreEl.textContent = `Score: ${correct}`;
  statusEl.textContent = "";

  qEl.textContent = q.question || "(問題文が空です)";

  clearChoiceStyles();
  choiceBtns.forEach((btn, i) => {
    const n = i + 1;
    btn.textContent = q[`choice${n}`] ?? "---";
    btn.disabled = false;
  });

  nextBtn.disabled = true;
}

function judge(selectedIdx) {
  if (answered) return;
  answered = true;

  const q = order[index];
  const ans = Number(q.answer);       // 1〜4 想定
  const sel = selectedIdx + 1;        // 1〜4 に変換

  setButtonsEnabled(false);

  if (sel === ans) {
    correct++;
    choiceBtns[selectedIdx].classList.add("correct");
    statusEl.textContent = "正解";
  } else {
    choiceBtns[selectedIdx].classList.add("wrong");
    if (ans >= 1 && ans <= 4) choiceBtns[ans - 1].classList.add("correct");
    statusEl.textContent = "不正解";
  }

  scoreEl.textContent = `Score: ${correct}`;
  nextBtn.disabled = false;
}

choiceBtns.forEach((btn, i) => {
  btn.addEventListener("click", () => judge(i));
});

nextBtn.addEventListener("click", () => {
  index++;
  if (index < order.length) {
    show();
  } else {
    progressEl.textContent = `終了（全${order.length}問）`;
    qEl.textContent = `正解 ${correct} / ${order.length}`;
    statusEl.textContent = "";
    nextBtn.disabled = true;
    setButtonsEnabled(false);
  }
});

restartBtn.addEventListener("click", start);

// ここが 404 の切り分けポイント
CSVUtil.load("./questions.csv").then(data => {
  questions = data;
  start();
}).catch(err => {
  progressEl.textContent = "読み込み失敗";
  qEl.textContent = "questions.csv を読み込めませんでした（パス/公開設定を確認）";
  statusEl.textContent = String(err);
});
