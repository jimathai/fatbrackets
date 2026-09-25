function xml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}
async function query(path) {
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) return [];
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) return [];
  return await response.json();
}
export default async function handler(req, res) {
  const slug = String(req.query.bracket || "").trim();
  const rows = await query(`tournaments?slug=eq.${encodeURIComponent(slug)}&visibility=eq.public&select=id,name,bracket_size&limit=1`);
  const tournament = rows[0];
  const contestants = tournament ? await query(`contestants?tournament_id=eq.${encodeURIComponent(tournament.id)}&select=name,seed&order=seed.asc`) : [];
  const title = tournament?.name || "FatBrackets";
  const names = contestants.filter((item) => item.name).slice(0, 32);
  const left = names.slice(0, Math.ceil(names.length / 2));
  const right = names.slice(Math.ceil(names.length / 2));
  const rowHeight = Math.min(27, 430 / Math.max(left.length, right.length, 1));
  const renderSide = (items, x) => items.map((item, index) => {
    const y = 145 + index * rowHeight;
    const label = item.name.length > 28 ? item.name.slice(0, 27) + "…" : item.name;
    return `<rect x="${x}" y="${y}" width="330" height="${Math.max(18, rowHeight - 3)}" rx="6" fill="#14223b" stroke="#40516e"/><text x="${x + 12}" y="${y + Math.max(13, rowHeight * .63)}" fill="#f8fafc" font-size="${Math.max(10, Math.min(14, rowHeight * .48))}" font-family="Arial" font-weight="700">${xml(label)}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#081426"/><stop offset="1" stop-color="#172744"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><text x="48" y="65" fill="#fff" font-size="38" font-family="Arial" font-weight="800">${xml(title)}</text><text x="1150" y="61" text-anchor="end" fill="#ef4444" font-size="22" font-family="Arial" font-weight="900">FATBRACKETS</text>${renderSide(left, 45)}${renderSide(right, 825)}<path d="M 390 155 H 600 V 560 M 810 155 H 600" stroke="#64748b" stroke-width="3" fill="none"/><text x="48" y="602" fill="#b7c3d7" font-size="16" font-family="Arial" font-weight="700">Fill it out • Remix it • Share it</text><text x="1150" y="602" text-anchor="end" fill="#b7c3d7" font-size="16" font-family="Arial" font-weight="700">fatbrackets.com</text></svg>`;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.status(200).send(svg);
}
