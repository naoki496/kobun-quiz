// csv.js (global)
// window.CSVUtil.load(url) -> Array<Object>

(function () {
  "use strict";

  function parseCSV(text) {
    // RFC4180 っぽい最低限：カンマ区切り、改行区切り、"..." 内のカンマ/改行、"" エスケープ対応
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

    // last
    row.push(cur);
    rows.push(row);

    // 末尾の空行を落とす
    while (rows.length && rows[rows.length - 1].every(v => String(v).trim() === "")) {
      rows.pop();
    }
    return rows;
  }

  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const header = rows[0].map(h => String(h).trim());
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        obj[header[j]] = r[j] ?? "";
      }
      out.push(obj);
    }
    return out;
  }

  async function load(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`CSV fetch failed: ${res.status} ${res.statusText} (${url})`);
    }
    const text = await res.text();
    const rows = parseCSV(text);
    return rowsToObjects(rows);
  }

  window.CSVUtil = { load };
})();
