// collection.js（完全復旧版）

const STORAGE_KEY_CARD_COUNTS = "kobunQuiz.v1.cardCounts";

// ==== 図鑑カードデータ（CSVから読み込み） ====
let ALL_CARDS = [];

// ==== URLパラメータ ====
const params = new URLSearchParams(location.search);
const previewAll = params.get("preview") === "1"; // 表示だけ全解放
const debugMode = params.get("debug") === "1";    // 強制解放ボタン表示

// ==== 保存データ取得 ====
function loadCounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CARD_COUNTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ==== CSV → カードオブジェクト正規化 ====
function normalizeCardRow(r) {
  return {
    id: String(r.id ?? "").trim(),
    rarity: Number(r.rarity) || 0,
    name: String(r.name ?? "").trim(),
    img: String(r.img ?? "").trim(),
    wiki: String(r.wiki ?? "").trim(),
  };
}

// ==== imgパス補正 ====
function resolveCardImgPath(p) {
  p = String(p ?? "").trim();
  if (!p) return "";
  if (p.includes("/") || p.startsWith("http")) return p;
  return `assets/cards/${p}`;
}

// ==== 図鑑描画 ====
function renderCollection() {
  const grid = document.getElementById("cardGrid");
  if (!grid) return;

  const counts = loadCounts();
  grid.innerHTML = "";

  ALL_CARDS.forEach((card) => {
    const owned = counts[card.id] ?? 0;

    // ✅preview=1なら全部表示
    const unlocked = previewAll ? true : owned > 0;

    // 外枠
    const item = document.createElement("div");
    item.className = unlocked
      ? "card-item"
      : "card-item card-locked";

    if (unlocked) {
      // ✅表示カード
      const link = document.createElement("a");
      link.className = "card-link";
      link.href = card.wiki || "#";
      link.target = card.wiki ? "_blank" : "_self";
      link.rel = card.wiki ? "noopener noreferrer" : "";

      const img = document.createElement("img");
      img.src = resolveCardImgPath(card.img);
      img.alt = card.name;

      const name = document.createElement("div");
      name.className = "card-item-name";
      name.textContent = card.name;

      const cnt = document.createElement("div");
      cnt.className = "card-item-count";
      cnt.textContent = `所持：${owned}`;

      link.appendChild(img);
      link.appendChild(name);
      link.appendChild(cnt);

      item.appendChild(link);

    } else {
      // ✅ロックカード
      const locked = document.createElement("div");
      locked.className = "locked-img";

      const name = document.createElement("div");
      name.className = "card-item-name";
      name.textContent = "？？？";

      const hint = document.createElement("div");
      hint.className = "card-hint";
      hint.textContent = "未入手";

      item.appendChild(locked);
      item.appendChild(name);
      item.appendChild(hint);
    }

    grid.appendChild(item);
  });

  // ✅debug=1なら強制解放ボタンを出す
  if (debugMode) {
    const btn = document.createElement("button");
    btn.textContent = "全カード解放（デバッグ）";
    btn.style.marginTop = "14px";

    btn.onclick = () => {
      const fake = {};
      ALL_CARDS.forEach((c) => (fake[c.id] = 1));
      localStorage.setItem(STORAGE_KEY_CARD_COUNTS, JSON.stringify(fake));
      alert("全カードを解放しました（端末内のみ）");
      location.reload();
    };

    grid.appendChild(btn);
  }
}

// ==== CSV読み込み ====
async function loadCardsCSV() {
  const rows = await loadCSV("./cards.csv");
  ALL_CARDS = rows.map(normalizeCardRow);
}

// ==== 起動 ====
(async () => {
  await loadCardsCSV();
  renderCollection();
})();
