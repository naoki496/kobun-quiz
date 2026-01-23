const CSVUtil = {
  async load(path) {
    const res = await fetch(path);
    const text = await res.text();
    return this.parse(text);
  },

  parse(text) {
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",");
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx];
      });
      rows.push(obj);
    }
    return rows;
  }
};
