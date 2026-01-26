// app.js (global)

// ===== Config =====
const TOTAL_QUESTIONS = 10;

// ✅音声ファイル（root/assets/ 配下）
const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3",
  wrong: "./assets/wrong.mp3"
};

// ===== State =====
let questions = [];
let order = [];
let index = 0;
let score = 0;
let locked = false;

// Combo
let combo = 0;
let maxCombo = 0;

// Mode
// normal: 10問
// streak: 連続正解（間違えたら終了）
let mode = "normal";
let started = false;      // START押下済み
let csvReady = false;     // CSVロード完了

// BGM/SE
let bgmOn = false;
let audioUnlocked = false;

// ===== DOM =====
const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const questionEl = document.getElementById("question");
const sublineEl = document.getElementById("subline");
const statusEl = document.getElementById("status");
const choiceBtns = Array.from(document.querySelectorAll(".choice"));
const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

const meterInner = document.getElementById("meterInner");
const meterLabel = document.getElementById("meterLabel");
const comboLabel = document.getElementById("comboLabel");

const quizEl = document.getElementById("quiz");
const bgmToggleBtn = document.getElementById("bgmToggle");
const modeSelect = document.getElementById("modeSelect");

const startScreenEl = document.getElementById("startScreen");
const startBtnEl = document.getElementById("startBtn");
const startHintEl = document.getElementById("startHint");

// ===== Audio objects =====
const bgmAudio = new Audio(AUDIO_FILES.bgm);
bgmAudio.loop = true;
bgmAudio.preload = "auto";
bgmAudio.volume = 0.45;

const seCorrect = new Audio(AUDIO_FILES.correct);
seCorrect.preload = "auto";
seCorrect.volume = 0.9;

const seWrong = new Audio(AUDIO_FILES.wrong);
seWrong.preload = "auto";
seWrong.volume = 0.9;

// ===== Utils =====
function disableChoices(disabled) {
  choiceBtns.forEach(b => (b.disabled = disabled));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeRow(r) {
  // answer は "1"～"4" 想定（CSV: id, question, source, choice1..4, answer）
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

// HTMLエスケープ
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 【】または〖〗の中だけ黄色発光でハイライト
function highlightBrackets(str) {
  const safe = escapeHtml(str);
  // 両方対応
  return safe
    .replace(/【(.*?)】/g, '【<span class="hl">$1</span>】')
    .replace(/〖(.*?)〗/g, '〖<span class="hl">$1</span>〗');
}

function updateScoreUI() {
  scoreEl.textContent = `Score: ${score}`;
}

function updateMeterUI() {
  if (mode === "normal") {
    const total = order.length || 1;
    const cur = Math.min(index + 1, total);
    const percent = Math.round((cur / total) * 100);
    meterLabel.textContent = `進捗 ${cur}/${total} (${percent}%)`;
    comboLabel.textContent = `最大COMBO x${maxCombo}`;
    meterInner.style.width = `${percent}%`;
    return;
  }

  // streak mode
  // 進捗バーは「現在連続」/「最大連続」を視覚化（上限は便宜的に10、越えたら100%張り付き）
  const cap = 10;
  const percent = Math.min(100, Math.round((combo / cap) * 100));
  meterLabel.textContent = `連続正解 ${combo}（最大 ${maxCombo}）`;
  comboLabel.textContent = `最大COMBO x${maxCombo}`;
  meterInner.style.width = `${percent}%`;
}

function updateStatusUI(message) {
  const comboText = combo >= 2 ? ` / COMBO x${combo}` : "";
  statusEl.textContent = `${message}${comboText}`;
}

// 演出：正解フラッシュ
function flashGood() {
  quizEl.classList.remove("flash-good");
  void quizEl.offsetWidth;
  quizEl.classList.add("flash-good");
}

// 演出：不正解揺れ
function shakeBad() {
  quizEl.classList.remove("shake");
  void quizEl.offsetWidth;
  quizEl.classList.add("shake");
}

// 音：初回アンロック
async function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  try {
    bgmAudio.muted = true;
    await bgmAudio.play();
    bgmAudio.pause();
    bgmAudio.currentTime = 0;
    bgmAudio.muted = false;
  } catch (_) {
    bgmAudio.muted = false;
  }
}

async function setBgm(on) {
  bgmOn = on;

  bgmToggleBtn?.classList.toggle("on", bgmOn);
  if (bgmToggleBtn) bgmToggleBtn.textContent = bgmOn ? "BGM: ON" : "BGM: OFF";

  if (!bgmOn) {
    try { bgmAudio.pause(); } catch (_) {}
    return;
  }

  try {
    await unlockAudioOnce();
    await bgmAudio.play();
  } catch (e) {
    console.warn(e);
    statusEl.textContent = "BGMの再生がブロックされました。もう一度BGMボタンを押してください。";
    bgmOn = false;
    bgmToggleBtn?.classList.remove("on");
    if (bgmToggleBtn) bgmToggleBtn.textContent = "BGM: OFF";
  }
}

function playSE(which) {
  try {
    const a = which === "correct" ? seCorrect : seWrong;
    a.currentTime = 0;
    a.play();
  } catch (_) {}
}

// ===== Overlay (Result) =====
function ensureResultOverlay() {
  let ov = document.getElementById("resultOverlay");
  if (ov) return ov;

  ov = document.createElement("div");
  ov.id = "resultOverlay";
  ov.className = "overlay";
  ov.style.display = "none";

  ov.innerHTML = `
    <div class="overlay-card">
      <div class="overlay-title">結果</div>
      <div id="resultMain" class="overlay-text"></div>
      <button id="resultCloseBtn" class="start-btn" type="button">閉じる</button>
      <div class="overlay-sub">「最初から」で再挑戦できます</div>
    </div>
  `;
  document.body.appendChild(ov);

  const closeBtn = document.getElementById("resultCloseBtn");
  closeBtn?.addEventListener("click", () => {
    ov.style.display = "none";
  });

  return ov;
}

function showResultOverlay(mainText) {
  const ov = ensureResultOverlay();
  const main = document.getElementById("resultMain");
  if (main) main.textContent = mainText;
  ov.style.display = "flex";
}

// ===== Core =====
function render() {
  const q = order[index];

  progressEl.textContent = (mode === "normal")
    ? `第${index + 1}問 / ${order.length}`
    : `出題中（連続正解モード）`;

  updateScoreUI();
  updateMeterUI();

  const text = q.source ? `${q.question}（${q.source}）` : q.question;
  questionEl.innerHTML = highlightBrackets(text);

  sublineEl.textContent = "";

  choiceBtns.forEach((btn, i) => {
    btn.textContent = q.choices[i] || "---";
    btn.classList.remove("correct", "wrong");
    btn.disabled = false;
  });

  statusEl.textContent = "";
  nextBtn.disabled = true;
  locked = false;
}

function buildOrderForMode() {
  const pool = shuffle([...questions]);

  if (mode === "normal") {
    order = pool.slice(0, Math.min(TOTAL_QUESTIONS, pool.length));
    return;
  }

  // streak: 全体をシャッフルして順に出す（尽きたら終了）
  order = pool;
}

function startNewSession() {
  if (!csvReady) {
    throw new Error("CSVがまだ読み込めていません。");
  }

  // 状態初期化
  score = 0;
  index = 0;
  combo = 0;
  maxCombo = 0;

  buildOrderForMode();

  if (!order.length) {
    throw new Error("問題が0件です（CSVの内容を確認してください）");
  }

  render();
}

function finish(reasonText) {
  progressEl.textContent = "終了";
  disableChoices(true);
  nextBtn.disabled = true;

  // UIは変えず、結果はオーバーレイで見せる
  const base = (mode === "normal")
    ? `結果：${score} / ${order.length}\n最大COMBO x${maxCombo}`
    : `結果：連続正解 ${combo}（最大 ${maxCombo}）\n正解数 ${score}`;

  const reason = reasonText ? `\n\n${reasonText}` : "";
  showResultOverlay(base + reason);
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
    flashGood();
    playSE("correct");
    updateStatusUI("正解");

    updateScoreUI();
    updateMeterUI();

    // normal: 次へで進む（従来どおり）
    // streak: 自動で次へ進むとテンポが良いが、UI変更を避けて「次へ」方式を維持
    nextBtn.disabled = false;
    return;
  }

  // 不正解
  combo = 0;

  choiceBtns[selectedIdx].classList.add("wrong");
  choiceBtns[correctIdx].classList.add("correct");
  shakeBad();
  playSE("wrong");
  updateStatusUI("不正解");

  updateScoreUI();
  updateMeterUI();

  if (mode === "streak") {
    // 連続正解モードは不正解で即終了（仕様）
    nextBtn.disabled = true;
    finish("連続正解モードは不正解で終了です。");
    return;
  }

  // normalは「次へ」で進める
  nextBtn.disabled = false;
}

// ===== Events =====
choiceBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await unlockAudioOnce();
    const idx = Number(btn.dataset.idx);
    judge(idx);
  });
});

nextBtn.addEventListener("click", () => {
  index++;

  if (index >= order.length) {
    if (mode === "streak") {
      finish("問題プールをすべて出し切りました。");
    } else {
      finish();
    }
    return;
  }

  render();
});

restartBtn.addEventListener("click", () => {
  try {
    startNewSession();
  } catch (e) {
    showError(e);
  }
});

bgmToggleBtn?.addEventListener("click", async () => {
  await unlockAudioOnce();
  await setBgm(!bgmOn);
});

modeSelect?.addEventListener("change", () => {
  mode = modeSelect.value;
  if (!started) return; // START前は切替だけ許容（開始はSTART押下）
  try {
    startNewSession(); // 問題中の切替＝新セッションで開始
  } catch (e) {
    showError(e);
  }
});

startBtnEl?.addEventListener("click", async () => {
  await unlockAudioOnce();
  started = true;

  // スタート画面を閉じる
  if (startScreenEl) startScreenEl.style.display = "none";

  // 選択中モードを反映して開始
  mode = modeSelect?.value ?? "normal";

  try {
    startNewSession();
  } catch (e) {
    showError(e);
  }
});

// ===== Error =====
function showError(err) {
  console.error(err);
  progressEl.textContent = "読み込み失敗";
  scoreEl.textContent = "Score: 0";
  questionEl.textContent = "CSVを読み込めませんでした。";
  sublineEl.textContent = "";
  statusEl.textContent = `詳細: ${err?.message ?? err}`;
  disableChoices(true);
  nextBtn.disabled = true;

  // スタート画面にもエラーを出す（STARTが押せない事故を防ぐ）
  if (startHintEl) startHintEl.textContent = `読み込み失敗: ${err?.message ?? err}`;
  if (startBtnEl) startBtnEl.disabled = true;
}

// ===== Boot =====
(async function boot() {
  try {
    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = `読み込み中…`;
    if (startHintEl) startHintEl.textContent = "問題を読み込んでいます…";

    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);

    csvReady = true;

    progressEl.textContent = `準備完了（STARTで開始）`;
    questionEl.textContent = "準備完了。STARTを押してください。";
    statusEl.textContent = "";

    if (startHintEl) startHintEl.textContent = "準備完了。STARTを押してください。";
    if (startBtnEl) startBtnEl.disabled = false;

    // 結果オーバーレイを先に作っておく（初回表示時のガタつき防止）
    ensureResultOverlay();
  } catch (e) {
    showError(e);
  }
})();
