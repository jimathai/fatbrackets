function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function fetchTournament(slug) {
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  const url = `${base}/rest/v1/tournaments?slug=eq.${encodeURIComponent(slug)}&visibility=eq.public&select=id,name,slug,bracket_size,owner_id&limit=1`;
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0] || null;
}

export default async function handler(req, res) {
  const slug = String(req.query.bracket || "").trim();
  const tournament = slug ? await fetchTournament(slug) : null;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const origin = `${proto}://${host}`;
  const appUrl = `${origin}/?bracket=${encodeURIComponent(slug)}`;
  const title = tournament?.name || "FatBrackets";
  const description = tournament ? `Fill out, remix, and share ${tournament.name} on FatBrackets.` : "Build, fill out, remix, and share brackets on FatBrackets.";
  const imageUrl = `${origin}/api/share-image?bracket=${encodeURIComponent(slug)}`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.status(200).send(`<!doctype html><html><head>
<meta charset="utf-8"><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:image" content="${esc(imageUrl)}"><meta property="og:url" content="${esc(`${origin}/share/${slug}`)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(imageUrl)}">
<meta http-equiv="refresh" content="0;url=${esc(appUrl)}"><script>location.replace(${JSON.stringify(appUrl)})</script>
</head><body><a href="${esc(appUrl)}">Open ${esc(title)} on FatBrackets</a></body></html>`);
}
