// csv.js (global)
// window.CSVUtil.load(url) -> Array of objects

(function () {
  function stripBOM(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function splitCSVLine(line) {
    // Minimal CSV parser: supports quoted fields and commas inside quotes
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        // double quote escape
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  function parseCSV(text) {
    text = stripBOM(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    const lines = text
      .split("\n")
      .map(l => l.trimEnd())
      .filter(l => l.length > 0);

    if (lines.length < 2) return [];

    const header = splitCSVLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCSVLine(lines[i]);
      const obj = {};
      header.forEach((h, idx) => {
        obj[h] = (cols[idx] ?? "").trim();
      });
      rows.push(obj);
    }
    return rows;
  }

  async function load(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} (${url})`);
    }
    const text = await res.text();
    return parseCSV(text);
  }

  window.CSVUtil = { load };
})();
