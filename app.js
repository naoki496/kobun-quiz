const TOTAL_QUESTIONS = 10;
let questions = [];
let order = [];
let index = 0;
let correct = 0;

const qEl = document.getElementById("question");
const sEl = document.getElementById("source");
const cEl = document.getElementById("choices");
const rEl = document.getElementById("result");
const stEl = document.getElementById("status");
const nextBtn = document.getElementById("nextBtn");

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function start() {
  order = shuffle([...questions]).slice(0, TOTAL_QUESTIONS);
  index = 0;
  correct = 0;
  rEl.textContent = "";
  nextBtn.style.display = "none";
  show();
}

function show() {
  const q = order[index];
  stEl.textContent = `第${index + 1}問 / ${TOTAL_QUESTIONS}`;
  qEl.textContent = q.question;
  sEl.textContent = q.source;

  cEl.innerHTML = "";
  for (let i = 1; i <= 4; i++) {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = q[`choice${i}`];
    btn.onclick = () => judge(btn, i, q.answer);
    cEl.appendChild(btn);
  }
}

function judge(btn, selected, answer) {
  const buttons = document.querySelectorAll(".choice-btn");
  buttons.forEach(b => (b.disabled = true));

  if (selected == answer) {
    btn.classList.add("correct");
    correct++;
  } else {
    btn.classList.add("wrong");
    buttons[answer - 1].classList.add("correct");
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
  qEl.textContent = "";
  sEl.textContent = "";
  cEl.innerHTML = "";
  rEl.textContent = `正解 ${correct} / ${TOTAL_QUESTIONS}`;
  nextBtn.style.display = "block";
}

nextBtn.onclick = start;

CSVUtil.load("./questions.csv").then(data => {
  questions = data;
  start();
});
