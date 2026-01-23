(function (global) {
  "use strict";

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (c === '"') {
        if (inQuotes && next === '"') { // "" -> "
          field += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === "," && !inQuotes) {
        row.push(field);
        field = "";
      } else if ((c === "\n" || c === "\r") && !inQuotes) {
        if (c === "\r" && next === "\n") i++;
        row.push(field);
        field = "";
        // 空行除外（ただし完全空行のみ）
        if (row.length > 1 || (row[0] || "").trim() !== "") rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }

    // last field
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  function normalizeHeader(h) {
    return (h || "").trim().toLowerCase();
  }

  // グローバルに公開（非module構成のため）
  global.CSVUtil = {
    parseCSV,
    normalizeHeader
  };
})(window);
