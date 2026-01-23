(() => {
  function stripBOM(s) {
    return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
  }

  // 超簡易CSV（今回の用途：カンマ区切り、ダブルクオート対応）
  function parseCSV(text) {
    text = stripBOM(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = text.split("\n").filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    const header = splitRow(lines[0]).map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitRow(lines[i]);
      const obj = {};
      header.forEach((key, idx) => {
        obj[key] = (cols[idx] ?? "").trim();
      });
      rows.push(obj);
    }
    return rows;
  }

  function splitRow(row) {
    const out = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < row.length; i++) {
      const ch = row[i];

      if (ch === '"') {
        // "" → "
        if (inQ && row[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  async function load(url) {
    // GitHub Pages のキャッシュ対策：no-store + クエリ
    const cacheBust = `v=${Date.now()}`;
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetch(url + sep + cacheBust, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    return parseCSV(text);
  }

  window.CSVUtil = { load };
})();
