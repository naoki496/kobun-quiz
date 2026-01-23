// app.js

// ====== 設定（テンポ最適化はここで一括管理） ======
const TOTAL_QUESTIONS = 10;

// テンポ：判定表示の待ち時間（短くし過ぎると“押し味”が消えるので 520〜650ms 推奨）
const FEEDBACK_MS = 550;

// 二重タップ事故防止（入力ロック：短時間だけ無視）
const INPUT_LOCK_MS = 220;

// ====== 状態 ======
let questions = [];
let order = [];
let idx = 0;
let score = 0;

// コンボ（C）
let combo = 0;
let maxCombo = 0;

// 入力ロック
let locked = false;

// ====== DOM ======
const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const sourceEl = document.getElementById("source");
const questionEl = document.getElementById("question");
const statusEl = document.getElementById("status");

const choiceBtns = Array.from(document.querySelectorAll(".choice"));

const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

// ====== utils ======
function shuffle(arr){
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 同じクラスの連続付与でもアニメを確実に発火させる
function kickAnim(el, className){
  el.classList.remove(className);
  void el.offsetWidth; // reflow
  el.classList.add(className);
}

function setStatus(text){
  statusEl.textContent = text || "";
  kickAnim(statusEl, "status-pop");
}

function setLocked(ms){
  locked = true;
  setTimeout(() => { locked = false; }, ms);
}

function disableChoices(disabled){
  choiceBtns.forEach(b => b.disabled = disabled);
}

function clearChoiceClasses(){
  choiceBtns.forEach(b => {
    b.classList.remove("correct", "wrong", "choice-hit", "choice-correct", "choice-wrong", "choice-reveal");
  });
}

// ====== 進行 ======
function start(){
  // 出題順を作成
  order = shuffle([...questions]).slice(0, Math.min(TOTAL_QUESTIONS, questions.length));
  idx = 0;
  score = 0;
  combo = 0;
  maxCombo = 0;

  nextBtn.disabled = true;
  progressEl.textContent = "開始します…";
  scoreEl.textContent = `Score: ${score}`;

  showQuestion();
}

function showQuestion(){
  clearChoiceClasses();
  disableChoices(false);

  const q = order[idx];
  if (!q){
    finish();
    return;
  }

  // 表示更新
  progressEl.textContent = `第${idx + 1}問 / ${order.length}`;
  scoreEl.textContent = `Score: ${score}`;
  questionEl.textContent = q.question || "";

  // source は無ければ空でOK
  sourceEl.textContent = q.source ? `出典：${q.source}` : "";

  // choices
  choiceBtns[0].textContent = q.choice1 || "---";
  choiceBtns[1].textContent = q.choice2 || "---";
  choiceBtns[2].textContent = q.choice3 || "---";
  choiceBtns[3].textContent = q.choice4 || "---";

  // ステータス（コンボ表示）
  if (combo >= 2) {
    setStatus(`COMBO × ${combo}`);
  } else {
    setStatus("");
  }
}

function judge(selectedIdx){
  if (locked) return;
  setLocked(INPUT_LOCK_MS);

  const q = order[idx];
  if (!q) return;

  // 以後の入力を止める
  disableChoices(true);

  const answer = Number(q.answer); // 1〜4想定
  const selected = selectedIdx + 1;

  const selectedBtn = choiceBtns[selectedIdx];

  // ヒット感（押した瞬間）
  kickAnim(selectedBtn, "choice-hit");

  if (selected === answer) {
    // 正解
    selectedBtn.classList.add("correct");
    kickAnim(selectedBtn, "choice-correct");

    score++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;

    // コンボ演出（C）
    if (combo >= 2) setStatus(`COMBO × ${combo}`);
    else setStatus("OK");

  } else {
    // 不正解
    selectedBtn.classList.add("wrong");
    kickAnim(selectedBtn, "choice-wrong");

    // 正解を強調して学習導線にする
    const ansBtn = choiceBtns[answer - 1];
    if (ansBtn){
      ansBtn.classList.add("correct");
      kickAnim(ansBtn, "choice-reveal");
    }

    // コンボBREAK
    if (combo >= 2) setStatus(`BREAK（${combo}で途切れ）`);
    else setStatus("NG");
    combo = 0;
  }

  // テンポ最適化：待ち時間は短めに固定
  setTimeout(() => {
    idx++;
    if (idx < order.length) showQuestion();
    else finish();
  }, FEEDBACK_MS);
}

function finish(){
  clearChoiceClasses();
  disableChoices(true);

  progressEl.textContent = "終了";
  questionEl.textContent = `結果：${score} / ${order.length}`;
  sourceEl.textContent = "";
  setStatus(`Max COMBO × ${maxCombo}`);

  nextBtn.disabled = false; // “次へ”＝もう一周
}

// ====== イベント ======
choiceBtns.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const i = Number(e.currentTarget.dataset.idx);
    if (Number.isNaN(i)) return;
    judge(i);
  }, { passive: true });
});

nextBtn.addEventListener("click", () => {
  start();
});

restartBtn.addEventListener("click", () => {
  start();
});

// ====== 起動 ======
CSVUtil.load("./questions.csv")
  .then((data) => {
    questions = data;

    if (!questions.length) {
      progressEl.textContent = "CSVが空です";
      questionEl.textContent = "questions.csv に問題が入っているか確認してください。";
      disableChoices(true);
      nextBtn.disabled = true;
      return;
    }

    start();
  })
  .catch((err) => {
    console.error(err);
    progressEl.textContent = "読み込み失敗";
    questionEl.textContent = "questions.csv の読み込みに失敗しました（Console参照）";
    disableChoices(true);
    nextBtn.disabled = true;
  });
