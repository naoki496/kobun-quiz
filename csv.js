// csv.js
// 依存なしの簡易CSVローダ + パーサ（ヘッダ行必須）

const CSVUtil = {
  async load(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`CSV fetch failed: ${res.status} ${res.statusText} (${path})`);
    }
    const text = await res.text();
    return CSVUtil.parse(text);
  },

  parse(csvText) {
    const rows = CSVUtil._parseRows(csvText);
    if (!rows.length) return [];

    const header = rows[0].map(h => (h || "").trim());
    const data = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;

      const obj = {};
      for (let c = 0; c < header.length; c++) {
        const key = header[c];
        if (!key) continue;
        obj[key] = (r[c] ?? "").toString().trim();
      }

      // 空行・壊れ行のガード
      if (!obj.question) continue;

      // answer を数値化（"1"〜"4" を想定）
      obj.answer = Number(obj.answer);

      data.push(obj);
    }
    return data;
  },

  // RFC4180 “完全準拠”までは不要という前提で、授業用途に十分な堅牢さを確保
  _parseRows(text) {
    const s = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const out = [];
    let row = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (inQ) {
        if (ch === '"') {
          const next = s[i + 1];
          if (next === '"') { // "" -> "
            cur += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQ = true;
        } else if (ch === ",") {
          row.push(cur);
          cur = "";
        } else if (ch === "\n") {
          row.push(cur);
          out.push(row);
          row = [];
          cur = "";
        } else {
          cur += ch;
        }
      }
    }

    // last cell
    row.push(cur);
    // last row（完全空行は除外）
    if (row.some(v => (v || "").trim() !== "")) out.push(row);

    return out;
  }
};
