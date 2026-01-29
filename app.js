// app.js (global)

const TOTAL_QUESTIONS = 10;

// ✅音声ファイル（root/assets/ 配下）
const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3",
  wrong: "./assets/wrong.mp3",
};

// ===== Card (Reward) =====
// ★3/★4/★5の抽選プール（フォールバック用）
const CARD_POOL = {
  3: [{ id: "sei_shonagon", name: "清少納言", img: "./assets/cards/sei_shonagon.png" }],
  4: [{ id: "murasaki", name: "紫式部", img: "./assets/cards/murasaki.png" }],
  5: [{ id: "basho", name: "松尾芭蕉", img: "./assets/cards/basho.png" }],
};

// ▼▼▼ A: cards.csv 受け皿（Single Source化の土台） ▼▼▼
const CARDS_CSV_FILENAME = "cards.csv";

// cards.csv から読み込んだ全カード
let cardsAll = [];

// rarity(3/4/5)ごとの抽選プール（cards.csv 読み込み後に構築）
let cardPoolByRarity = { 3: [], 4: [], 5: [] };

function normalizeCardRow(r) {
  // cards.csv: id, rarity, name, img, wiki, weight
  const id = String(r.id ?? "").trim();
  const rarity = Number(String(r.rarity ?? "").trim());
  const name = String(r.name ?? "").trim();
  const img = String(r.img ?? "").trim();
  const wiki = String(r.wiki ?? "").trim();
  const weight = Number(String(r.weight ?? "").trim()) || 1; // Cで使う（今は保持だけ）
  return { id, rarity, name, img, wiki, weight };
}

function rebuildCardPoolsFromCsv() {
  const next = { 3: [], 4: [], 5: [] };
  if (!Array.isArray(cardsAll)) cardsAll = [];

  for (const c of cardsAll) {
    // 不正行はプールに入れない（落とさない方針）
    if (!c || !c.id) continue;
    if (c.rarity === 3 || c.rarity === 4 || c.rarity === 5) {
      next[c.rarity].push(c);
    }
  }
  cardPoolByRarity = next;
}

function validateCardsCsv() {
  const errs = [];
  const warns = [];

  // 1) 件数
  if (!Array.isArray(cardsAll) || cardsAll.length === 0) {
    warns.push("cards.csv: カードが0件です（カード抽選が発生しません）");
  }

  // 2) id 重複チェック
  const seen = new Map();
  for (const c of (cardsAll || [])) {
    const key = c?.id;
    if (!key) {
      errs.push("cards.csv: id が空の行があります");
      continue;
    }
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [id, n] of seen.entries()) {
    if (n >= 2) errs.push(`cards.csv: id が重複しています: "${id}" x${n}`);
  }

  // 3) 必須項目 & rarity
  for (const c of (cardsAll || [])) {
    if (!c?.id) continue;
    if (!c.name) warns.push(`cards.csv: name が空です (id=${c.id})`);
    if (!c.img) errs.push(`cards.csv: img が空です (id=${c.id})`);
    if (!(c.rarity === 3 || c.rarity === 4 || c.rarity === 5)) {
      errs.push(`cards.csv: rarity が 3/4/5 ではありません (id=${c.id}, rarity=${c.rarity})`);
    }
  }

  // 4) rarity別枚数
  const s3 = (cardPoolByRarity[3] || []).length;
  const s4 = (cardPoolByRarity[4] || []).length;
  const s5 = (cardPoolByRarity[5] || []).length;

  // ---- 結果出力（UI非変更：consoleのみ）----
  if (err
