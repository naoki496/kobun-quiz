(() => {
  const TOTAL_QUESTIONS = 10;

  let questions = [];
  let order = [];
  let idx = 0;
  let correct = 0;
  let combo = 0;
  let locked = false;

  const progressEl = document.getElementById("progress");
  const scoreEl = document.getElementById("score");
  const comboEl = document.getElementById("combo");
  const statusEl = document.getElementById("status");
  const questionEl = document.getElementById("question");
  const sourceEl = document.getElementById("source");
  const resultEl = document.getElementById("result");
  const choicesWrap = document.getElementById("choices");

  const nextBtn = document.getElementById("nextBtn");
  const restartBtn = document.getElementById("restartBtn");

  const soundToggle = document.getElementById("soundToggle");
  const sourceToggle = document.getElementById("sourceToggle");

  function setLoading(on, msg) {
    progressEl.textContent = msg ?? (on ? "読み込み中…" : "");
    nextBtn.disabled = on;
    restartBtn.disabled = on;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function normalizeRow(q) {
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

  // WebAudio：短いSE（外部音源なし）
  let audioCtx = null;
  function beep(type) {
    if (!soundToggle?.checked) return;

    try {
      audioCtx = audioCtx ?? new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();

      const now = ctx.currentTime;
      o.type = "sine";

      // correct: 高め / wrong: 低め
      const freq = type === "ok" ? 880 : 220;
      o.frequency.setValueAtTime(freq, now);

      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      o.connect(g);
      g.connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.2);
    } catch (_) {
      // 音が鳴らない端末は黙ってスルー（授業ではこの方が安全）
    }
  }

  function updateHUD() {
    scoreEl.textContent = `Score: ${correct}`;
    comboEl.textContent = `Combo: ${combo}`;
  }

  function start() {
    locked = false;
    idx = 0;
    correct = 0;
    combo = 0;
    updateHUD();

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

    // 出典ON/OFF
    if (sourceToggle?.checked && q.source) {
      sourceEl.textContent = `出典：${q.source}`;
      sourceEl.style.display = "";
    } else {
      sourceEl.textContent = "";
      sourceEl.style.display = "none";
    }

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
      combo++;
      beep("ok");
    } else {
      clickedBtn.classList.add("wrong");
      statusEl.textContent = "不正解…";
      combo = 0;
      beep("ng");

      const rightBtn = btns[answer - 1];
      if (rightBtn) rightBtn.classList.add("correct");
    }

    updateHUD();
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
    sourceEl.style.display = "none";

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
    if (progressEl.textContent === "結果") start();
    else next();
  });

  restartBtn.addEventListener("click", start);

  // トグル変更時：表示に反映
  sourceToggle?.addEventListener("change", () => {
    if (order.length > 0 && progressEl.textContent !== "結果") render();
  });

  (async () => {
    try {
      setLoading(true, "読み込み中…");
      const data = await window.CSVUtil.load("./questions.csv");
      questions = data.map(normalizeRow).filter(q => q.question && q.answer >= 1 && q.answer <= 4);
      setLoading(false, "");
      restartBtn.disabled = false;
      nextBtn.disabled = false;
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
