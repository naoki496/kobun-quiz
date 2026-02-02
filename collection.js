// collection.js

const STORAGE_KEY_CARD_COUNTS = "kobunQuiz.v1.cardCounts";

// ==== 図鑑カードデータ（CSVから読み込みます） ====
let ALL_CARDS = [];

// ===== 保存データ取得 =====
function loadCounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CARD_COUNTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ===== CSV → カードオブジェクト正規化 =====
function normalizeCardRow(r) {
  return {
    id: String(r.id ?? "").trim(),
    rarity: Number(r.rarity) || 0,
    name: String(r.name ?? "").trim(),
    img: String(r.img ?? "").trim(),
    wiki: String(r.wiki ?? "").trim(),
  };
}

// ===== 図鑑を描画 =====
function renderCollection() {
  const grid = document.getElementById("cardGrid");
  if (!grid) return;

  const params = new URLSearchParams(location.search);
  const previewAll = params.get("preview") === "1"; // ✅表示だけ全開放（保存は変更しない）

  const counts = loadCounts();
  grid.innerHTML = "";

    ALL_CARDS.forEach((card) => {
    const owned = counts[card.id] ?? 0;
    const unlocked = owned > 0;

    // 外枠（CSSの .card-item / .card-locked を使う）
    const item = document.createElement("div");
    item.className = unlocked ? "card-item" : "card-item card-locked";

    if (unlocked) {
      // クリックで詳細へ（必要なら）
      // いまは図鑑表示が主目的なので、リンクでラップ（CSSの .card-link）
      const link = document.createElement("a");
      link.className = "card-link";
      link.href = card.wiki || "#";
      link.target = card.wiki ? "_blank" : "_self";
      link.rel = card.wiki ? "noopener noreferrer" : "";

      const img = document.createElement("img");
      img.src = card.img;          // cards.csv の img が相対パスで正しい前提
      img.alt = card.name || "card";

      const name = document.createElement("div");
      name.className = "card-item-name";
      name.textContent = card.name || "(no name)";

      const cnt = document.createElement("div");
      cnt.className = "card-item-count";
      cnt.textContent = `所持：${owned}`;

      link.appendChild(img);
      link.appendChild(name);
      link.appendChild(cnt);
      item.appendChild(link);
    } else {
      // ロック時：ネタバレしないUI（CSSの .locked-img / .card-hint）
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


// ===== Debug Unlock (only with ?debug=1) =====
function enableDebugUnlock() {
  const params = new URLSearchParams(location.search);
  if (params.get("debug") !== "1") return;

  const btn = document.createElement("button");
  btn.textContent = "🛠 全カード解放（デバッグ）";
  btn.style.margin = "12px auto";
  btn.style.padding = "10px 14px";
  btn.style.borderRadius = "12px";
  btn.style.border = "1px solid rgba(0,255,255,0.4)";
  btn.style.background = "rgba(0,0,0,0.35)";
  btn.style.color = "#fff";
  btn.style.cursor = "pointer";
  btn.style.fontWeight = "900";

  btn.addEventListener("click", () => {
    const unlockData = {};
    ALL_CARDS.forEach((c) => (unlockData[c.id] = 1));
    localStorage.setItem(STORAGE_KEY_CARD_COUNTS, JSON.stringify(unlockData));
    alert("✅デバッグ解放しました！");
    location.reload();
  });

  document.body.insertBefore(btn, document.body.firstChild);
}

// ===== CSV読込 & 初期化 =====
async function bootCollection() {
  if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
    console.error("CSVUtil が見つかりません（csv.js 読み込み順を確認してください）");
    return;
  }

  const baseUrl = new URL("./", location.href).toString();
  const cardsCsvUrl = new URL("cards.csv", baseUrl).toString();

  const raw = await window.CSVUtil.load(cardsCsvUrl);
  ALL_CARDS = raw.map(normalizeCardRow).filter((c) => c.id);

  renderCollection();
  enableDebugUnlock();
}

bootCollection().catch((e) => console.error(e));
