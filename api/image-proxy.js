import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 10 * 1024 * 1024;
const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

function sniffImageType(bytes, declaredType = "") {
  const declared = declaredType.toLowerCase().split(";")[0].trim();
  if (declared.startsWith("image/")) return declared;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 6) {
    const sig = Buffer.from(bytes.slice(0, 6)).toString("ascii");
    if (sig === "GIF87a" || sig === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12) {
    const brand = Buffer.from(bytes.slice(4, 12)).toString("ascii");
    if (brand.includes("ftypavif") || brand.includes("ftypavis")) return "image/avif";
  }
  return "";
}

function isPrivateIp(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const p = address.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] >= 224);
  }
  const value = address.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
}

async function validateTarget(target) {
  if (!/^https?:$/.test(target.protocol)) throw new Error("Only http/https image URLs are allowed.");
  const hostname = target.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "metadata.google.internal") throw new Error("That image host is not allowed.");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw new Error("That image host is not allowed.");
}

async function fetchImage(url, hops = 0) {
  if (hops > 5) throw new Error("Too many redirects.");
  const target = new URL(url);
  await validateTarget(target);
  const response = await fetch(target, { redirect: "manual", headers: { ...BROWSER_HEADERS, referer: `${target.protocol}//${target.host}/` } });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Image redirect is missing a location.");
    return fetchImage(new URL(location, target).toString(), hops + 1);
  }
  if (!response.ok) throw new Error(`Image host returned ${response.status}.`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new Error("Image is too large.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error("Image is too large.");
  const type = sniffImageType(bytes, response.headers.get("content-type") || "");
  if (!type) throw new Error("URL did not return a recognizable image.");
  return { bytes, type };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const raw = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  if (!raw) return res.status(400).json({ error: "Missing image URL" });
  try {
    const { bytes, type } = await fetchImage(raw);
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
    return res.status(200).send(Buffer.from(bytes));
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : "Could not load image" });
  }
}
