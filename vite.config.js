var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
var BROWSER_HEADERS = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
};
function sniffImageType(bytes, declaredType) {
    if (declaredType === void 0) { declaredType = ""; }
    var declared = declaredType.toLowerCase().split(";")[0].trim();
    if (declared.startsWith("image/"))
        return declared;
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return "image/jpeg";
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a)
        return "image/png";
    if (bytes.length >= 12 && new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP")
        return "image/webp";
    if (bytes.length >= 6) {
        var sig = new TextDecoder("ascii").decode(bytes.slice(0, 6));
        if (sig === "GIF87a" || sig === "GIF89a")
            return "image/gif";
    }
    if (bytes.length >= 12) {
        var brand = new TextDecoder("ascii").decode(bytes.slice(4, 12));
        if (brand.includes("ftypavif") || brand.includes("ftypavis"))
            return "image/avif";
    }
    return "";
}
function blockedHost(hostname) {
    var host = hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local") ||
        /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}
function fetchImage(raw_1) {
    return __awaiter(this, arguments, void 0, function (raw, hops) {
        var target, response, location_1, bytes, _a, type;
        if (hops === void 0) { hops = 0; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (hops > 5)
                        throw new Error("Too many redirects");
                    target = new URL(raw);
                    if (!/^https?:$/.test(target.protocol) || blockedHost(target.hostname))
                        throw new Error("Image host is not allowed");
                    return [4 /*yield*/, fetch(target, {
                            redirect: "manual",
                            headers: __assign(__assign({}, BROWSER_HEADERS), { referer: "".concat(target.protocol, "//").concat(target.host, "/") }),
                        })];
                case 1:
                    response = _b.sent();
                    if (response.status >= 300 && response.status < 400) {
                        location_1 = response.headers.get("location");
                        if (!location_1)
                            throw new Error("Image redirect is missing a location");
                        return [2 /*return*/, fetchImage(new URL(location_1, target).toString(), hops + 1)];
                    }
                    if (!response.ok)
                        throw new Error("Image host returned ".concat(response.status));
                    _a = Uint8Array.bind;
                    return [4 /*yield*/, response.arrayBuffer()];
                case 2:
                    bytes = new (_a.apply(Uint8Array, [void 0, _b.sent()]))();
                    if (bytes.byteLength > MAX_IMAGE_BYTES)
                        throw new Error("Image is too large");
                    type = sniffImageType(bytes, response.headers.get("content-type") || "");
                    if (!type)
                        throw new Error("URL did not return a recognizable image");
                    return [2 /*return*/, { bytes: bytes, type: type }];
            }
        });
    });
}
export default defineConfig({
    plugins: [
        react(),
        {
            name: "fatbrackets-local-image-proxy",
            configureServer: function (server) {
                var _this = this;
                server.middlewares.use(function (req, res, next) { return __awaiter(_this, void 0, void 0, function () {
                    var requestUrl, raw, _a, bytes, type, error_1;
                    return __generator(this, function (_b) {
                        switch (_b.label) {
                            case 0:
                                requestUrl = new URL(req.url || "/", "http://localhost");
                                if (requestUrl.pathname !== "/api/image-proxy") {
                                    next();
                                    return [2 /*return*/];
                                }
                                _b.label = 1;
                            case 1:
                                _b.trys.push([1, 3, , 4]);
                                raw = requestUrl.searchParams.get("url");
                                if (!raw) {
                                    res.statusCode = 400;
                                    res.setHeader("Content-Type", "text/plain; charset=utf-8");
                                    res.end("Missing image URL");
                                    return [2 /*return*/];
                                }
                                return [4 /*yield*/, fetchImage(raw)];
                            case 2:
                                _a = _b.sent(), bytes = _a.bytes, type = _a.type;
                                res.setHeader("Content-Type", type);
                                res.setHeader("Cache-Control", "public, max-age=3600");
                                res.setHeader("Access-Control-Allow-Origin", "*");
                                res.statusCode = 200;
                                res.end(bytes);
                                return [3 /*break*/, 4];
                            case 3:
                                error_1 = _b.sent();
                                res.statusCode = 502;
                                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                                res.end(error_1 instanceof Error ? error_1.message : "Could not load image");
                                return [3 /*break*/, 4];
                            case 4: return [2 /*return*/];
                        }
                    });
                }); });
            },
        },
    ],
    server: {
        host: true,
        port: 5173,
    },
});
