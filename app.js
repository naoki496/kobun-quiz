(function () {
  "use strict";

  // ===== 設定 =====
  const CSV_PATH = "./questions.csv"; // index.html と同階層
  const QUESTION_LIMIT = 0; // 0なら全問。10などで制限可。

  // ===== 状態 =====
  let questions = [];
  let currentIndex = 0;
  let score = 0;
  let locked = false;

  // ===== DOM =====
  const elQuestion = document.getElementById("question");
  const elStatus = document.getElementById("status");
  const elProgress = document.getElementById("progress");
  const elScore = document.getElementById("score");
  const btnNext = document.getElementById("nextBtn");
  const btnRestart = document.getElementById("restartBtn");
  const choiceButtons = Array.from(document.querySelectorAll(".choice"));

  function headerIndexMap(header) {
    const h = header.map(CSVUtil.normalizeHeader);

    // 期待：id, question, source, choice1..4, answer
    const idx = {
      id: h.indexOf("id"),
      question: h.indexOf("question"),
      source: h.indexOf("source"),
      c1: h.indexOf("choice1"),
      c2: h.indexOf("choice2"),
      c3: h.indexOf("choice3"),
      c4: h.indexOf("choice4"),
      answer: h.indexOf("answer"),

      // フォールバック（旧形式など）
      text: h.indexOf("text"),
      a: h.indexOf("a"),
      b: h.indexOf("b"),
      c: h.indexOf("c"),
      d: h.indexOf("d"),
      correct: h.indexOf("correct"),
      choices: h.indexOf("choices"),
    };

    return idx;
  }

  function toAnswerIndex(ansRaw) {
    const s = (ansRaw || "").trim().toUpperCase();
    if (["A", "B", "C", "D"].includes(s)) return ["A", "B", "C", "D"].indexOf(s);

    const n = Number(s);
    if (!Number.isNaN(n)) {
      if (n >= 1 && n <= 4) return n - 1; // 1-4
      if (n >= 0 && n <= 3) return n;     // 0-3
    }
    return -1;
  }

  function buildQuestionObjects(rows) {
    if (!rows.length) return [];
    const idx = headerIndexMap(rows[0]);

    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];

      const idVal = (idx.id >= 0 ? cols[idx.id] : "").trim() || String(r);

      const textVal = (
        (idx.question >= 0 ? cols[idx.question] : "") ||
        (idx.text >= 0 ? cols[idx.text] : "")
      ).trim();

      const sourceVal = (idx.source >= 0 ? (cols[idx.source] || "") : "").trim();

      // choices: choice1-4 が最優先
      let choices = [];
      if (idx.c1 >= 0 && idx.c2 >= 0 && idx.c3 >= 0 && idx.c4 >= 0) {
        choices = [cols[idx.c1], cols[idx.c2], cols[idx.c3], cols[idx.c4]]
          .map(s => (s || "").trim());
      }

      // フォールバック：a,b,c,d
      if (choices.length !== 4 || choices.some(v => !v)) {
        if (idx.a >= 0 && idx.b >= 0 && idx.c >= 0 && idx.d >= 0) {
          choices = [cols[idx.a], cols[idx.b], cols[idx.c], cols[idx.d]]
            .map(s => (s || "").trim());
        }
      }

      // フォールバック：choices 1列を "..."|"..." 形式
      if (choices.length !== 4 || choices.some(v => !v)) {
        const choicesRaw = idx.choices >= 0 ? (cols[idx.choices] || "") : "";
        if (choicesRaw) {
          const split = choicesRaw.split("|").map(s => s.trim()).filter(Boolean);
          if (split.length === 4) choices = split;
        }
      }

      const ansRaw = (
        (idx.answer >= 0 ? cols[idx.answer] : "") ||
        (idx.correct >= 0 ? cols[idx.correct] : "")
      );

      const ansIndex = toAnswerIndex(ansRaw);

      if (!textVal || choices.length !== 4 || ansIndex < 0) continue;

      out.push({
        id: idVal,
        text: textVal,
        source: sourceVal,
        choices,
        answerIndex: ansIndex
      });
    }
    return out;
  }

  function render() {
    if (!questions.length) {
      elQuestion.textContent = "問題がありません（CSVの列名・形式を確認してください）。";
      elProgress.textContent = "";
      return;
    }

    const q = questions[currentIndex];
    elProgress.textContent = `Q ${currentIndex + 1} / ${questions.length}（ID: ${q.id}）`;
    elScore.textContent = `Score: ${score}`;

    const sourceLine = q.source ? `\n［出典］${q.source}` : "";
    elQuestion.textContent = q.text + sourceLine;

    for (let i = 0; i < choiceButtons.length; i++) {
      const btn = choiceButtons[i];
      btn.textContent = `${i + 1}. ${q.choices[i]}`;
      btn.classList.remove("correct", "wrong");
      btn.disabled = false;
    }

    elStatus.textContent = "選択してください。";
    btnNext.disabled = true;
    locked = false;
  }

  function finish() {
    elProgress.textContent = `終了（${questions.length}問）`;
    elQuestion.textContent = `結果：${score} / ${questions.length}\nおつかれさまでした。`;
    elStatus.textContent = "「最初から」で再挑戦できます。";
    choiceButtons.forEach(btn => (btn.disabled = true));
    btnNext.disabled = true;
    locked = true;
  }

  function onChoose(choiceIndex) {
    if (locked) return;
    locked = true;

    const q = questions[currentIndex];
    const correct = q.answerIndex;

    choiceButtons.forEach(btn => (btn.disabled = true));

    if (choiceIndex === correct) {
      score++;
      choiceButtons[choiceIndex].classList.add("correct");
      elStatus.textContent = "正解。";
    } else {
      choiceButtons[choiceIndex].classList.add("wrong");
      choiceButtons[correct].classList.add("correct");
      elStatus.textContent = `不正解。正解は ${correct + 1} です。`;
    }

    btnNext.disabled = false;
    btnNext.focus();
  }

  function next() {
    if (currentIndex + 1 >= questions.length) return finish();
    currentIndex++;
    render();
  }

  function restart() {
    score = 0;
    currentIndex = 0;
    render();
  }

  // ===== イベント =====
  choiceButtons.forEach(btn => {
    btn.addEventListener("click", () => onChoose(Number(btn.dataset.idx)));
  });
  btnNext.addEventListener("click", next);
  btnRestart.addEventListener("click", restart);

  // ===== 初期ロード =====
  (async function init() {
    try {
      const res = await fetch(CSV_PATH, { cache: "no-store" });
      if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
      const text = await res.text();

      const rows = CSVUtil.parseCSV(text);
      questions = buildQuestionObjects(rows);

      if (QUESTION_LIMIT > 0 && questions.length > QUESTION_LIMIT) {
        questions = questions.slice(0, QUESTION_LIMIT);
      }

      if (!questions.length) {
        elQuestion.textContent = "CSVは読めましたが、問題が0件でした。列名と形式を確認してください。";
        elStatus.textContent = "（CSVの先頭2〜3行を確認できれば、完全に合わせ込めます）";
        elProgress.textContent = "";
        return;
      }

      render();
    } catch (e) {
      console.error(e);
      elQuestion.textContent = "CSVの読み込みに失敗しました。";
      elStatus.textContent =
        "原因候補：①questions.csvが同階層にない ②GitHub Pagesで未公開 ③ファイル名の大小文字違い";
      elProgress.textContent = "";
    }
  })();
})();
