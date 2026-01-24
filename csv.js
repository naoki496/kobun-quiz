// csv.js (global)
// window.CSVUtil.load(url) -> Promise<Array<Object>>

(function () {
  "use strict";

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          row.push(cur);
          cur = "";
        } else if (ch === "\n") {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = "";
        } else if (ch === "\r") {
          // ignore
        } else {
          cur += ch;
        }
      }
    }

    row.push(cur);
    rows.push(row);

    const cleaned = rows.filter(r => r.some(cell => String(cell).trim() !== ""));
    return cleaned;
  }

  async function load(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText}`);

    const text = await res.text();
    const table = parseCSV(text);
    if (!table.length) return [];

    const header = table[0].map(h => String(h).trim());
    const data = [];

    for (let i = 1; i < table.length; i++) {
      const r = table[i];
      const obj = {};
      for (let c = 0; c < header.length; c++) {
        obj[header[c]] = r[c] ?? "";
      }
      data.push(obj);
    }
    return data;
  }

  window.CSVUtil = { load };
})();
