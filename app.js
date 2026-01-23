(() => {
  const TOTAL_QUESTIONS = 10;

  let questions = [];
  let order = [];
  let idx = 0;
  let correct = 0;
  let locked = false;

  const progressEl = document.getElementById("progress");
  const scoreEl = document.getElementById("score");
  const statusEl = document.getElementById("status");
  const questionEl = document.getElementById("question");
  const sourceEl = document.getElementById("source");
  const resultEl = document.getElementById("result");
  const choicesWrap = document.getElementById("choices");

  const nextBtn = document.getElementById("nextBtn");
  const restartBtn = document.getElementById("restartBtn");

  function setLoading(on, msg) {
    progressEl.textContent = msg ?? (on ? "読み込み中…" : "");
    nextBtn.disabled = on;
    restartBtn.disabled = on;
  }

  function shuffle(arr) {
    // Fisher–Yates
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function normalizeRow(q) {
    // answer は "1"～"4" を想定
    const a = Number(q.answer);
    return {
      id: q.id ?? "",
      question: q.question ?? "",
      source: q.source ?? "",
      choice1: q.choice1 ?? "",
      choice2: q.choice2 ?? "",
      choice3: q.choice3 ?? "",
      choice4: q.choice4 ?? "",
      answer: Number.isFinite(a) ? a : 0,
    };
  }

  function start() {
    locked = false;
    idx = 0;
    correct = 0;
    scoreEl.textContent = `Score: ${correct}`;
    resultEl.textContent = "";
    resultEl.className = "result";

    const pool = questions.slice();
    shuffle(pool);
    order = pool.slice(0, Math.min(TOTAL_QUESTIONS, pool.length));

    if (order.length === 0) {
      statusEl.textContent = "問題がありません（CSV内容を確認してください）";
      questionEl.textContent = "";
      sourceEl.textContent = "";
      return;
    }

    nextBtn.disabled = true;
    restartBtn.disabled = false;
    render();
  }

  function render() {
    locked = false;
    const q = order[idx];

    progressEl.textContent = `第${idx + 1}問 / ${order.length}`;
    statusEl.textContent = "1つ選んでください";
    questionEl.textContent = q.question;
    sourceEl.textContent = q.source ? `出典：${q.source}` : "";

    // 4択ボタンを詰め替え
    const btns = choicesWrap.querySelectorAll(".choice");
    btns.forEach((b, i) => {
      const n = i + 1;
      b.disabled = false;
      b.classList.remove("correct", "wrong");
      b.textContent = q[`choice${n}`] || `選択肢${n}`;
      b.onclick = () => judge(n, b);
    });

    nextBtn.textContent = "次へ";
    nextBtn.disabled = true;
  }

  function judge(selected, clickedBtn) {
    if (locked) return;
    locked = true;

    const q = order[idx];
    const answer = q.answer;

    const btns = Array.from(choicesWrap.querySelectorAll(".choice"));
    btns.forEach(b => (b.disabled = true));

    const ok = selected === answer;
    if (ok) {
      clickedBtn.classList.add("correct");
      statusEl.textContent = "正解！";
      correct++;
      scoreEl.textContent = `Score: ${correct}`;
    } else {
      clickedBtn.classList.add("wrong");
      statusEl.textContent = "不正解…";
      // 正解を強調
      const rightBtn = btns[answer - 1];
      if (rightBtn) rightBtn.classList.add("correct");
    }

    nextBtn.disabled = false;
  }

  function next() {
    if (idx < order.length - 1) {
      idx++;
      render();
      return;
    }
    finish();
  }

  function finish() {
    progressEl.textContent = `結果`;
    statusEl.textContent = "終了";
    questionEl.textContent = "";
    sourceEl.textContent = "";
    choicesWrap.querySelectorAll(".choice").forEach(b => {
      b.disabled = true;
      b.textContent = "---";
      b.classList.remove("correct", "wrong");
      b.onclick = null;
    });

    resultEl.textContent = `正解 ${correct} / ${order.length}`;
    resultEl.className = "result done";
    nextBtn.textContent = "もう一度（シャッフル）";
    nextBtn.disabled = false;
  }

  nextBtn.addEventListener("click", () => {
    if (order.length === 0) return;
    // 終了画面ならstart、途中ならnext
    if (progressEl.textContent === "結果") start();
    else next();
  });

  restartBtn.addEventListener("click", start);

  // 起動
  (async () => {
    try {
      setLoading(true, "読み込み中…");
      const data = await window.CSVUtil.load("./questions.csv");
      questions = data.map(normalizeRow).filter(q => q.question && q.answer >= 1 && q.answer <= 4);
      setLoading(false, "");
      start();
    } catch (e) {
      console.error(e);
      setLoading(false, "読み込み失敗");
      statusEl.textContent = "エラー";
      resultEl.textContent = `CSV読み込みに失敗しました：${e.message}`;
      nextBtn.disabled = true;
      restartBtn.disabled = true;
    }
  })();
})();
