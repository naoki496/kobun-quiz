// csv.js
const CSVUtil = {
  load: async function (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("CSV fetch failed: " + res.status);
    }

    const text = await res.text();
    const lines = text.trim().split("\n");

    const headers = lines[0].split(",").map(h => h.trim());

    return lines.slice(1).map(line => {
      const values = line.split(",").map(v => v.trim());
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] ?? "";
      });
      return obj;
    });
  }
};
