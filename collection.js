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
        <img src="${card.img}" alt="${card.name}">
        <div class="card-info">
          <div class="card-title">★${card.rarity} ${card.name}</div>
          <div class="card-count">所持：${owned}</div>
        </div>
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
