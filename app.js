document.getElementById("question").textContent = "app.js 読み込みOK（修正版）";
const TOTAL_QUESTIONS = 10;

let questions = [];
let order = [];
let index = 0;
let correct = 0;

const qEl = document.getElementById("question");
const stEl = document.getElementById("status");
const nextBtn = document.getElementById("nextBtn");
const choiceBtns = document.querySelectorAll(".choice");

// シャッフル
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function start() {
  order = shuffle(questions).slice(0, TOTAL_QUESTIONS);
  index = 0;
  correct = 0;
  nextBtn.disabled = true;
  show();
}

function show() {
  const q = order[index];
  stEl.textContent = `第${index + 1}問 / ${TOTAL_QUESTIONS}`;
  qEl.textContent = q.question;

  choiceBtns.forEach((btn, i) => {
    btn.disabled = false;
    btn.className = "choice";
    btn.textContent = q[`choice${i + 1}`];
    btn.onclick = () => judge(i + 1, q.answer, btn);
  });
}

function judge(selected, answer, btn) {
  choiceBtns.forEach(b => (b.disabled = true));

  if (selected == answer) {
    btn.classList.add("correct");
    correct++;
  } else {
    btn.classList.add("wrong");
    choiceBtns[answer - 1].classList.add("correct");
  }

  setTimeout(() => {
    index++;
    if (index < order.length) {
      show();
    } else {
      finish();
    }
  }, 800);
}

function finish() {
  qEl.textContent = `結果：${correct} / ${TOTAL_QUESTIONS}`;
  stEl.textContent = "お疲れさまでした";
  nextBtn.disabled = false;
}

nextBtn.onclick = start;

// CSV読み込み（BOM対策込み）
CSVUtil.load("./questions.csv").then(data => {
  questions = data;
  start();
}).catch(err => {
  qEl.textContent = "CSVの読み込みに失敗しました";
  console.error(err);
});
