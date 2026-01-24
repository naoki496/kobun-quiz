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

const quizEl = document.getElementById("quiz");

const progressEl = document.getElementById("progress");
const meterBarEl = document.getElementById("meterBar");

const scoreEl = document.getElementById("score");
const questionEl = document.getElementById("question");
const statusEl = document.getElementById("status");

const choiceBtns = Array.from(document.querySelectorAll(".choice"));

const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

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

function updateMeterUI() {
  // index は 0-based。表示上は「今出している問題」を含めた進捗にする
  const total = order.length || 1;
  const current = Math.min(index + 1, total);
  const pct = Math.round((current / total) * 100);
  meterBarEl.style.width = `${pct}%`;
}

function updateStatusUI(message) {
  const comboText = combo >= 2 ? ` / COMBO x${combo}` : "";
  statusEl.textContent = `${message}${comboText}`;
}

/* ===== 安全なHTML生成（【】ハイライト用） ===== */
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 【...】を <span class="hl">...</span> に置換（中身はエスケープ維持）
function highlightBrackets(s) {
  const raw = String(s ?? "");
  // 先に全体をエスケープし、その後に【】を検出したいが、エスケープ後は文字列が変わる。
  // そこで「プレーン文字列を走査→部分ごとにescape→結合」という方式にする。
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const open = raw.indexOf("【", i);
    if (open === -1) {
      out += escapeHTML(raw.slice(i));
      break;
    }
    const close = raw.indexOf("】", open + 1);
    if (close === -1) {
      // 閉じがない場合は残りを通常表示
      out += escapeHTML(raw.slice(i));
      break;
    }
    out += escapeHTML(raw.slice(i, open));
    const inner = raw.slice(open + 1, close);
    out += `<span class="hl">【${escapeHTML(inner)}】</span>`;
    i = close + 1;
  }
  return out;
}

function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateMeterUI();
  updateScoreUI();

  // 問題文：出典は軽く後ろに（必要なら別行に分けても良い）
  const body = q.source ? `${q.question}（${q.source}）` : q.question;
  questionEl.innerHTML = highlightBrackets(body);

  choiceBtns.forEach((btn, i) => {
    btn.textContent = q.choices[i] || "---";
    btn.classList.remove("correct", "wrong");
    btn.disabled = false;
  });

  // 画面フラッシュのクラスは持ち越さない
  quizEl.classList.remove("flash-ok", "flash-ng");

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
  meterBarEl.style.width = "100%";
  questionEl.textContent = `結果：${score} / ${order.length}`;
  statusEl.textContent = `おつかれさまでした。最大COMBO x${maxCombo}`;
  disableChoices(true);
  nextBtn.disabled = true;
}

function flash(type) {
  // 同じアニメを連続発火させるため remove→reflow→add
  const cls = type === "ok" ? "flash-ok" : "flash-ng";
  quizEl.classList.remove(cls);
  void quizEl.offsetWidth;
  quizEl.classList.add(cls);
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
    flash("ok");
  } else {
    combo = 0;

    choiceBtns[selectedIdx].classList.add("wrong");
    choiceBtns[correctIdx].classList.add("correct");
    updateStatusUI("不正解");
    flash("ng");
  }

  updateScoreUI();

  // 自動遷移はしない（明示的に「次へ」）
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
  meterBarEl.style.width = "0%";
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
    meterBarEl.style.width = "0%";

    const raw = await window.CSVUtil.load(csvUrl);

    // 正規化（ここで変なデータがあると理由付きで落ちる）
    questions = raw.map(normalizeRow);

    start();
  } catch (e) {
    showError(e);
  }
})();
