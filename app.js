if (window.__QUIZ_APP_LOADED__) {
  throw new Error("app.js loaded twice");
}
window.__QUIZ_APP_LOADED__ = true;
const TOTAL_QUESTIONS = 10;

let questions = [];
let order = [];
let index = 0;
let correct = 0;

const qEl = document.getElementById("question");
const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

const choiceBtns = Array.from(document.querySelectorAll("button.choice"));

function shuffle(arr) {
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeAnswer(a) {
  // CSVの answer が "1"〜"4" を想定
  const n = Number(String(a).trim());
  return Number.isFinite(n) ? n : NaN;
}

function setChoicesEnabled(enabled) {
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

  scoreEl.textContent = `Score: ${correct}`;
  statusEl.textContent = "";
  nextBtn.disabled = true;

  show();
}

function show() {
  const q = order[index];
  clearChoiceStyles();
  setChoicesEnabled(true);
  nextBtn.disabled = true;

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  qEl.textContent = q.question ?? "";

  // choice1..4 を既存ボタンに反映
  choiceBtns[0].textContent = q.choice1 ?? "---";
  choiceBtns[1].textContent = q.choice2 ?? "---";
  choiceBtns[2].textContent = q.choice3 ?? "---";
  choiceBtns[3].textContent = q.choice4 ?? "---";

  // クリック時の判定を付け替え
  const ans = normalizeAnswer(q.answer); // 1..4
  choiceBtns.forEach((btn, i) => {
    btn.onclick = () => judge(i + 1, ans);
  });
}

function judge(selected, answer) {
  setChoicesEnabled(false);

  if (selected === answer) {
    correct++;
    choiceBtns[selected - 1].classList.add("correct");
    statusEl.textContent = "正解";
  } else {
    choiceBtns[selected - 1].classList.add("wrong");
    if (answer >= 1 && answer <= 4) {
      choiceBtns[answer - 1].classList.add("correct");
    }
    statusEl.textContent = "不正解";
  }

  scoreEl.textContent = `Score: ${correct}`;
  nextBtn.disabled = false;
}

nextBtn.addEventListener("click", () => {
  index++;
  if (index < order.length) {
    show();
  } else {
    progressEl.textContent = `終了（${order.length}問）`;
    qEl.textContent = `正解 ${correct} / ${order.length}`;
    statusEl.textContent = "";
    setChoicesEnabled(false);
    nextBtn.disabled = true;
  }
});

restartBtn.addEventListener("click", start);

// CSV読み込み
CSVUtil.load("./questions.csv")
  .then(data => {
    questions = data;
    // 読み込み確認
    progressEl.textContent = `読み込み完了（${questions.length}問）`;
    start();
  })
  .catch(err => {
    console.error(err);
    progressEl.textContent = "読み込み失敗（Consoleを確認）";
    qEl.textContent = "CSVの読み込みに失敗しました。";
    statusEl.textContent = String(err);
  });
