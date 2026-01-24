// app.js (global) - FINAL
// Features: BGM/SE opt-in, shake, flash, meter, 【】highlight, combo, no auto-advance

const TOTAL_QUESTIONS = 10;

// ========= Audio files (ここだけあなたの実ファイル名に合わせて修正) =========
// 例: assets/bgm.mp3 のようにフォルダに入れているなら "assets/bgm.mp3"
const AUDIO_FILES = {
  bgm: "bgm.mp3",
  seCorrect: "correct.mp3",
  seWrong: "wrong.mp3",
};

// 音量（0.0〜1.0）
const AUDIO_VOLUME = {
  bgm: 0.35,
  se: 0.7,
};

// SEを鳴らすか
const ENABLE_SE = true;

// ========= State =========
let questions = [];
let order = [];
let index = 0;
let score = 0;
let locked = false;

// Combo
let combo = 0;
let maxCombo = 0;

// BGM opt-in
let bgmEnabled = false;
let bgmReady = false;

// ========= DOM (existing) =========
const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const questionEl = document.getElementById("question");
const statusEl = document.getElementById("status");
const choiceBtns = Array.from(document.querySelectorAll(".choice"));
const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

// ========= Helpers: DOM safety =========
function must(el, name) {
  if (!el) throw new Error(`${name} が見つかりません（index.html の要素ID/クラスを確認）`);
  return el;
}
must(progressEl, "#progress");
must(scoreEl, "#score");
must(questionEl, "#question");
must(statusEl, "#status");
must(nextBtn, "#nextBtn");
must(restartBtn, "#restartBtn");
if (choiceBtns.length !== 4) {
  throw new Error(`.choice ボタンが4つ必要です（現在: ${choiceBtns.length}）`);
}

// ========= UI additions: Meter / BGM Toggle / Flash Overlay =========
let meterWrapEl = null;
let meterFillEl = null;
let meterTextEl = null;
let overlayEl = null;
let bgmToggleBtn = null;

function ensureUIExtras() {
  // --- Meter (progress bar) ---
  // Insert under #meta if exists, else under body top
  const meta = document.getElementById("meta") || document.body;

  if (!meterWrapEl) {
    meterWrapEl = document.createElement("div");
    meterWrapEl.id = "meterWrap";
    meterWrapEl.style.cssText =
      "margin:10px 0 12px 0; padding:10px; border:1px solid rgba(255,255,255,0.18); border-radius:14px; background:rgba(0,0,0,0.25);";

    meterTextEl = document.createElement("div");
    meterTextEl.id = "meterText";
    meterTextEl.style.cssText =
      "font-size:14px; opacity:0.9; margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;";

    const barOuter = document.createElement("div");
    barOuter.style.cssText =
      "height:12px; border-radius:999px; background:rgba(255,255,255,0.12); overflow:hidden;";

    meterFillEl = document.createElement("div");
    meterFillEl.id = "meterFill";
    meterFillEl.style.cssText =
      "height:100%; width:0%; border-radius:999px; background:rgba(255,255,255,0.72); transition:width 220ms ease;";

    barOuter.appendChild(meterFillEl);
    meterWrapEl.appendChild(meterTextEl);
    meterWrapEl.appendChild(barOuter);

    // meta の直後に置く
    if (meta.parentNode) {
      meta.parentNode.insertBefore(meterWrapEl, meta.nextSibling);
    } else {
      document.body.insertBefore(meterWrapEl, document.body.firstChild);
    }
  }

  // --- BGM toggle button (opt-in) ---
  if (!bgmToggleBtn) {
    bgmToggleBtn = document.createElement("button");
    bgmToggleBtn.id = "bgmToggle";
    bgmToggleBtn.type = "button";
    bgmToggleBtn.textContent = "BGM: OFF";
    bgmToggleBtn.style.cssText =
      "margin:8px 0 0 0; padding:10px 14px; border-radius:14px; border:1px solid rgba(255,255,255,0.18); background:rgba(0,0,0,0.25); color:inherit; font-size:14px; cursor:pointer;";
    // meter の上に置く（見つけやすく）
    const insertPoint = meterWrapEl || (document.getElementById("quiz") || document.body);
    insertPoint.parentNode.insertBefore(bgmToggleBtn, insertPoint);

    bgmToggleBtn.addEventListener("click", async () => {
      bgmEnabled = !bgmEnabled;
      bgmToggleBtn.textContent = bgmEnabled ? "BGM: ON" : "BGM: OFF";
      if (bgmEnabled) {
        await startBGM(); // user gesture 直後なので再生制限を回避しやすい
      } else {
        stopBGM();
      }
    });
  }

  // --- Flash overlay ---
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.id = "fxOverlay";
    overlayEl.style.cssText =
      "position:fixed; inset:0; pointer-events:none; opacity:0; transition:opacity 120ms ease; z-index:9999;";
    document.body.appendChild(overlayEl);
  }
}

// ========= Audio =========
let bgmAudio = null;
let seCorrectAudio = null;
let seWrongAudio = null;

function buildAudio(url, loop) {
  const a = new Audio(url);
  a.loop = !!loop;
  a.preload = "auto";
  return a;
}

function audioUrl(file) {
  // GitHub Pages のルート基準で解決（現在URLのディレクトリに対して）
  const baseUrl = new URL("./", location.href).toString();
  return new URL(file, baseUrl).toString();
}

function initAudioIfNeeded() {
  if (bgmAudio) return;

  bgmAudio = buildAudio(audioUrl(AUDIO_FILES.bgm), true);
  bgmAudio.volume = AUDIO_VOLUME.bgm;

  seCorrectAudio = buildAudio(audioUrl(AUDIO_FILES.seCorrect), false);
  seCorrectAudio.volume = AUDIO_VOLUME.se;

  seWrongAudio = buildAudio(audioUrl(AUDIO_FILES.seWrong), false);
  seWrongAudio.volume = AUDIO_VOLUME.se;
}

async function startBGM() {
  try {
    initAudioIfNeeded();
    if (!bgmAudio) return;

    // すでに再生中なら何もしない
    if (!bgmAudio.paused) return;

    // 再生（ブラウザ制限に引っかかる場合はここで握りつぶしてUIはONのままにする）
    await bgmAudio.play();
    bgmReady = true;
  } catch (e) {
    console.warn("BGM play blocked:", e);
    // ONにしたのに鳴らない場合、ユーザーに再タップさせる導線
    updateStatusUI("BGM再生がブロックされました。もう一度BGMボタンを押してください");
  }
}

function stopBGM() {
  if (!bgmAudio) return;
  bgmAudio.pause();
  // 位置は保持（好みによって 0 にしてもOK）
  // bgmAudio.currentTime = 0;
}

function playSE(type) {
  if (!ENABLE_SE) return;
  try {
    initAudioIfNeeded();
    const a = type === "correct" ? seCorrectAudio : seWrongAudio;
    if (!a) return;
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch {
    // ignore
  }
}

// ========= Effects (No CSS required) =========
function flash(kind) {
  // kind: "correct" | "wrong"
  ensureUIExtras();
  if (!overlayEl) return;

  overlayEl.style.background =
    kind === "correct"
      ? "rgba(255,255,255,0.18)"
      : "rgba(255,60,60,0.18)";

  overlayEl.style.opacity = "1";
  setTimeout(() => {
    overlayEl.style.opacity = "0";
  }, 120);
}

function shake(el) {
  // Web Animations API（CSS不要）
  if (!el || !el.animate) return;
  el.animate(
    [
      { transform: "translateX(0px)" },
      { transform: "translateX(-8px)" },
      { transform: "translateX(8px)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(6px)" },
      { transform: "translateX(0px)" },
    ],
    { duration: 240, iterations: 1, easing: "ease-out" }
  );
}

// ========= Logic helpers =========
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

function updateStatusUI(message) {
  // コンボ表示を統一的にここで処理
  const comboText = combo >= 2 ? ` / COMBO x${combo}` : "";
  statusEl.textContent = `${message}${comboText}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightBrackets(text) {
  // 【】で囲われた部分だけ強調（複数箇所対応）
  // innerHTML で入れるので必ず escape → 置換
  const safe = escapeHtml(text);

  // 【 ... 】の中を黄色っぽく
  // 例: 【助動詞】 → <span ...>【助動詞】</span>
  return safe.replace(/【([^】]+)】/g, (m) => {
    return `<span style="background:rgba(255,220,0,0.22); padding:0 6px; border-radius:8px; font-weight:700;">${m}</span>`;
  });
}

function setQuestionText(q) {
  // 出典を付ける（不要ならここを変更）
  const body = q.source ? `${q.question}（${q.source}）` : q.question;
  questionEl.innerHTML = highlightBrackets(body);
}

function updateMeterUI() {
  ensureUIExtras();

  const total = order.length || 1;
  const current = Math.min(index + 1, total);
  const pct = Math.round((current / total) * 100);

  if (meterFillEl) meterFillEl.style.width = `${pct}%`;

  if (meterTextEl) {
    const left = `進捗 ${current}/${total} (${pct}%)`;
    const right = `最大COMBO x${maxCombo}`;
    meterTextEl.innerHTML = `<span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span>`;
  }
}

// ========= Game flow =========
function render() {
  const q = order[index];

  progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();
  updateMeterUI();

  setQuestionText(q);

  choiceBtns.forEach((btn, i) => {
    btn.textContent = q.choices[i] || "---";
    btn.classList.remove("correct", "wrong");
    btn.disabled = false;
  });

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

  // BGMは opt-in のみ。start() では自動再生しない。
  updateScoreUI();
  updateMeterUI();
  render();
}

function finish() {
  progressEl.textContent = "終了";
  questionEl.textContent = `結果：${score} / ${order.length}`;
  statusEl.textContent = `おつかれさまでした。最大COMBO x${maxCombo}`;
  disableChoices(true);
  nextBtn.disabled = true;
  updateMeterUI();
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
    flash("correct");
    playSE("correct");
  } else {
    combo = 0;

    choiceBtns[selectedIdx].classList.add("wrong");
    choiceBtns[correctIdx].classList.add("correct");
    updateStatusUI("不正解");
    flash("wrong");
    playSE("wrong");

    // shake quiz container if exists, else body
    const quizEl = document.getElementById("quiz") || document.body;
    shake(quizEl);
  }

  updateScoreUI();
  updateMeterUI();

  // 自動遷移OFF：次へボタンで進む
  nextBtn.disabled = false;
}

// ========= Events =========
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

// ページ離脱時はBGM停止（任意）
window.addEventListener("pagehide", () => {
  stopBGM();
});

function showError(err) {
  console.error(err);
  progressEl.textContent = "読み込み失敗";
  scoreEl.textContent = "Score: 0";
  questionEl.textContent = "CSVを読み込めませんでした。";
  statusEl.textContent = `詳細: ${err?.message ?? err}`;
  disableChoices(true);
  nextBtn.disabled = true;
  // Meterは残す（原因切り分けしやすい）
  ensureUIExtras();
  if (meterFillEl) meterFillEl.style.width = "0%";
  if (meterTextEl) meterTextEl.textContent = "進捗 0/0";
}

// ========= Boot =========
(async function boot() {
  try {
    ensureUIExtras();

    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    progressEl.textContent = `読み込み中…`;
    statusEl.textContent = "";

    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);

    // ここではBGMを勝手に再生しない（opt-in）
    progressEl.textContent = "準備完了";
    start();
  } catch (e) {
    showError(e);
  }
})();
