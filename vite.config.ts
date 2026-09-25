import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

function sniffImageType(bytes: Uint8Array, declaredType = "") {
  const declared = declaredType.toLowerCase().split(";")[0].trim();
  if (declared.startsWith("image/")) return declared;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 6) {
    const sig = new TextDecoder("ascii").decode(bytes.slice(0, 6));
    if (sig === "GIF87a" || sig === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12) {
    const brand = new TextDecoder("ascii").decode(bytes.slice(4, 12));
    if (brand.includes("ftypavif") || brand.includes("ftypavis")) return "image/avif";
  }
  return "";
}

function blockedHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local") ||
    /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

async function fetchImage(raw: string, hops = 0): Promise<{ bytes: Uint8Array; type: string }> {
  if (hops > 5) throw new Error("Too many redirects");
  const target = new URL(raw);
  if (!/^https?:$/.test(target.protocol) || blockedHost(target.hostname)) throw new Error("Image host is not allowed");
  const response = await fetch(target, {
    redirect: "manual",
    headers: { ...BROWSER_HEADERS, referer: `${target.protocol}//${target.host}/` },
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Image redirect is missing a location");
    return fetchImage(new URL(location, target).toString(), hops + 1);
  }
  if (!response.ok) throw new Error(`Image host returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Image is too large");
  const type = sniffImageType(bytes, response.headers.get("content-type") || "");
  if (!type) throw new Error("URL did not return a recognizable image");
  return { bytes, type };
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "fatbrackets-local-image-proxy",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const requestUrl = new URL(req.url || "/", "http://localhost");
          if (requestUrl.pathname !== "/api/image-proxy") {
            next();
            return;
          }

          try {
            const raw = requestUrl.searchParams.get("url");
            if (!raw) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end("Missing image URL");
              return;
            }

            const { bytes, type } = await fetchImage(raw);
            res.setHeader("Content-Type", type);
            res.setHeader("Cache-Control", "public, max-age=3600");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.statusCode = 200;
            res.end(bytes);
          } catch (error) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(error instanceof Error ? error.message : "Could not load image");
          }
        });
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
  },
});
