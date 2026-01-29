// collection.js

const STORAGE_KEY_CARD_COUNTS = "kobunQuiz.v1.cardCounts";

/*
  図鑑用カード定義
  ※未取得は名前を表示しないため、ここに定義してもUIで隠す
*/
const ALL_CARDS = [
  { id: "sei_shonagon", rarity: 3, name: "清少納言", img: "./assets/cards/sei_shonagon.png" },
  { id: "murasaki", rarity: 4, name: "紫式部", img: "./assets/cards/murasaki.png" },
  { id: "basho", rarity: 5, name: "松尾芭蕉", img: "./assets/cards/basho.png" },
];

// ✅保存データ取得
function loadCounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CARD_COUNTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function renderCollection() {
  const grid = document.getElementById("cardGrid");
  const counts = loadCounts();

  grid.innerHTML = "";

  ALL_CARDS.forEach((card) => {
    const owned = counts[card.id] ?? 0;
    const unlocked = owned > 0;

    const div = document.createElement("div");
    div.className = "card-entry";

  div.innerHTML = unlocked
  ? `
    <a href="${card.wiki}" target="_blank" class="card-link">
      <img src="${card.img}" alt="${card.name}">
      <div class="card-info">
        <div class="card-title">★${card.rarity} ${card.name}</div>
        <div class="card-count">所持：${owned}</div>
        <div class="card-hint">▶ 解説を見る</div>
      </div>
    </a>
  `
      : `
        <div class="card-locked">
          <div class="locked-img"></div>
          <div class="card-info">
            <div class="card-title">★？ ？？？？</div>
            <div class="card-count">未発見</div>
          </div>
        </div>
      `;

    grid.appendChild(div);
  });
}

renderCollection();

const ALL_CARDS = [
  {
    id: "sei_shonagon",
    rarity: 3,
    name: "清少納言",
    img: "./assets/cards/sei_shonagon.png",
    wiki: "https://ja.wikipedia.org/wiki/清少納言"
  },
  {
    id: "murasaki",
    rarity: 4,
    name: "紫式部",
    img: "./assets/cards/murasaki.png",
    wiki: "https://ja.wikipedia.org/wiki/紫式部"
  },
  {
    id: "basho",
    rarity: 5,
    name: "松尾芭蕉",
    img: "./assets/cards/basho.png",
    wiki: "https://ja.wikipedia.org/wiki/松尾芭蕉"
  },
];

// ===== Debug Unlock (only with ?debug=1) =====
function enableDebugUnlock() {
  const params = new URLSearchParams(location.search);

  if (params.get("debug") !== "1") return; // ✅通常は何もしない

  // ✅デバッグボタン生成
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
    // ✅全カードに所持数1を付与
    const unlockData = {};
    ALL_CARDS.forEach((c) => {
      unlockData[c.id] = 1;
    });

    localStorage.setItem(STORAGE_KEY_CARD_COUNTS, JSON.stringify(unlockData));

    alert("✅デバッグ解放しました！");
    location.reload();
  });

  // ✅図鑑の上に追加
  document.body.insertBefore(btn, document.body.firstChild);
}

// 呼び出し
enableDebugUnlock();
