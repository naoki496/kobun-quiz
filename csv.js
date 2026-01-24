// csv.js (global)
// window.CSVUtil.load(url) -> Promise<array<object>>
// 文字列中のカンマ/改行/ダブルクォートに対応（基本的なRFC4180相当）

(function () {
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (c === '"' && next === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          cur += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ",") {
          row.push(cur);
          cur = "";
        } else if (c === "\r") {
          // ignore
        } else if (c === "\n") {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = "";
        } else {
          cur += c;
        }
      }
    }

    // last cell
    row.push(cur);
    rows.push(row);

    // remove trailing empty lines
    while (rows.length && rows[rows.length - 1].every(v => (v ?? "").trim() === "")) {
      rows.pop();
    }

    if (!rows.length) return [];

    const header = rows[0].map(h => (h ?? "").trim());
    const data = [];

    for (let r = 1; r < rows.length; r++) {
      const obj = {};
      for (let c = 0; c < header.length; c++) {
        obj[header[c]] = rows[r][c] ?? "";
      }
      data.push(obj);
    }
    return data;
  }

  async function load(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`CSV fetch失敗: ${res.status} ${res.statusText} (${url})`);
    }
    const text = await res.text();
    return parseCSV(text);
  }

  window.CSVUtil = { load };
})();
