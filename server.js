#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, "public");
const STORAGE_DIR = path.join(APP_DIR, "storage");
const DB_PATH = path.join(STORAGE_DIR, "transfers.json");
const HISTORY_PATH = path.join(STORAGE_DIR, "history.json");
const CODE_PATH = path.join(APP_DIR, ".upload-code");
const PUBLIC_ORIGIN_PATH = path.join(APP_DIR, "public-origin.txt");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = Math.max(MIN_TTL_MS, Number(process.env.FILEDROP_MAX_TTL_MS || 24 * 60 * 60 * 1000));
const DEFAULT_TTL_MS = clampTtl(Number(process.env.FILEDROP_TTL_MS || 60 * 60 * 1000));
const DEFAULT_MAX_SIZE = "25gb";
const MAX_BYTES = parseByteSize(process.env.FILEDROP_MAX_SIZE || DEFAULT_MAX_SIZE);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

fs.mkdirSync(STORAGE_DIR, { recursive: true });

const uploadCode = readOrCreateUploadCode();
const transfers = new Map(loadTransfers().map((transfer) => [transfer.id, transfer]));
let history = loadHistory();

cleanupExpired().catch((error) => {
  console.warn("No se pudo limpiar archivos vencidos:", error.message);
});
setInterval(() => {
  cleanupExpired().catch((error) => {
    console.warn("No se pudo limpiar archivos vencidos:", error.message);
  });
}, 60_000).unref();

const server = http.createServer(async (req, res) => {
  addBaseHeaders(res);

  try {
    const url = new URL(req.url, currentOrigin(req));
    const route = decodeURIComponent(url.pathname);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (route === "/api/info" && req.method === "GET") {
      sendJson(req, res, 200, {
        ttlMs: DEFAULT_TTL_MS,
        defaultTtlMs: DEFAULT_TTL_MS,
        minTtlMs: MIN_TTL_MS,
        maxTtlMs: MAX_TTL_MS,
        maxTtlText: formatDurationLabel(MAX_TTL_MS),
        maxBytes: MAX_BYTES,
        maxSizeText: formatBytes(MAX_BYTES),
        publicOrigin: readPublicOrigin(),
        localOrigins: localOrigins(req),
        now: Date.now(),
      });
      return;
    }

    if (route === "/api/auth" && req.method === "POST") {
      const body = await readJson(req, 4096);
      sendJson(req, res, isValidCode(body.code) ? 200 : 401, {
        ok: isValidCode(body.code),
      });
      return;
    }

    if (route === "/api/uploads" && req.method === "POST") {
      await handleUpload(req, res);
      return;
    }

    if (route === "/api/transfers" && req.method === "GET") {
      if (!requireUploadCode(req, res)) return;
      await cleanupExpired();
      sendJson(req, res, 200, {
        transfers: [...transfers.values()]
          .sort((a, b) => b.uploadedAt - a.uploadedAt)
          .map(publicTransfer),
      });
      return;
    }

    if (route === "/api/stats" && req.method === "GET") {
      if (!requireUploadCode(req, res)) return;
      await cleanupExpired();
      sendJson(req, res, 200, await buildStats());
      return;
    }

    const transferMatch = route.match(/^\/api\/transfers\/([A-Za-z0-9_-]+)$/);
    if (transferMatch && req.method === "GET") {
      const lookup = await findActiveTransfer(transferMatch[1]);
      if (lookup === "expired") {
        sendJson(req, res, 410, { error: "El link expiro." });
        return;
      }
      if (!lookup) {
        sendJson(req, res, 404, { error: "Archivo no encontrado." });
        return;
      }
      sendJson(req, res, 200, { transfer: publicTransfer(lookup) });
      return;
    }

    if (transferMatch && req.method === "DELETE") {
      if (!requireUploadCode(req, res)) return;
      const removed = await removeTransfer(transferMatch[1]);
      sendJson(req, res, removed ? 200 : 404, { ok: removed });
      return;
    }

    const downloadMatch = route.match(/^\/download\/([A-Za-z0-9_-]+)$/);
    if (downloadMatch && (req.method === "GET" || req.method === "HEAD")) {
      await handleDownload(req, res, downloadMatch[1]);
      return;
    }

    if (req.method === "GET" && (route === "/" || route === "/admin" || route.match(/^\/d\/[A-Za-z0-9_-]+$/))) {
      await serveFile(req, res, path.join(PUBLIC_DIR, "index.html"), "no-store");
      return;
    }

    if (req.method === "GET") {
      const staticPath = path.resolve(PUBLIC_DIR, `.${route}`);
      if (staticPath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
        await serveFile(req, res, staticPath, "no-cache");
        return;
      }
    }

    sendNotFound(req, res);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendNotFound(req, res);
      return;
    }

    const status = error.statusCode || 500;
    sendJson(req, res, status, {
      error: status === 500 ? "Error interno del servidor." : error.message,
    });
  }
});

server.requestTimeout = 0;
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`El puerto ${PORT} ya esta ocupado. Prueba con: $env:PORT=8788; npm start`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("FileDrop temporal listo");
  console.log(`Codigo privado para subir: ${uploadCode}`);
  console.log(`Tiempo por defecto de cada archivo: ${formatDurationLabel(DEFAULT_TTL_MS)}`);
  console.log(`Tiempo maximo configurable: ${formatDurationLabel(MAX_TTL_MS)}`);
  console.log(`Tamano maximo por archivo: ${formatBytes(MAX_BYTES)}`);
  console.log("");
  console.log("Abre la app en:");
  for (const origin of localOrigins()) console.log(`  ${origin}`);
  console.log("");
});

async function handleUpload(req, res) {
  if (!requireUploadCode(req, res)) return;

  const ttlMs = resolveUploadTtl(req.headers["x-file-ttl-ms"]);
  if (ttlMs instanceof Error) {
    sendJson(req, res, ttlMs.statusCode || 400, { error: ttlMs.message });
    req.destroy();
    return;
  }

  const maxDownloads = resolveMaxDownloads(req.headers["x-max-downloads"]);
  if (maxDownloads instanceof Error) {
    sendJson(req, res, maxDownloads.statusCode || 400, { error: maxDownloads.message });
    req.destroy();
    return;
  }

  const deleteAfterMaxDownloads = maxDownloads !== null && parseBoolean(req.headers["x-delete-after-max-downloads"]);

  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    sendJson(req, res, 413, { error: `El archivo supera el limite de ${formatBytes(MAX_BYTES)}.` });
    req.destroy();
    return;
  }

  const originalName = sanitizeOriginalName(req.headers["x-file-name"]);
  const mime = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].slice(0, 120);
  const id = crypto.randomBytes(18).toString("base64url");
  const storedName = `${id}.bin`;
  const tempPath = path.join(STORAGE_DIR, `${id}.part`);
  const finalPath = path.join(STORAGE_DIR, storedName);
  let bytes = 0;

  const counter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) {
        const error = new Error(`El archivo supera el limite de ${formatBytes(MAX_BYTES)}.`);
        error.statusCode = 413;
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(req, counter, fs.createWriteStream(tempPath, { flags: "wx" }));
    await fsp.rename(tempPath, finalPath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    if (!res.writableEnded) {
      sendJson(req, res, error.statusCode || 499, {
        error: error.statusCode ? error.message : "La subida se interrumpio.",
      });
    }
    return;
  }

  const now = Date.now();
  const transfer = {
    id,
    originalName,
    size: bytes,
    mime,
    storedName,
    uploadedAt: now,
    expiresAt: now + ttlMs,
    ttlMs,
    maxDownloads,
    deleteAfterMaxDownloads,
    downloadCount: 0,
    lastDownloadedAt: null,
  };

  transfers.set(id, transfer);
  await saveTransfers();

  const origin = readPublicOrigin() || currentOrigin(req);
  sendJson(req, res, 201, {
    transfer: publicTransfer(transfer),
    shareUrl: `${origin}/d/${id}`,
    downloadUrl: `${origin}/download/${id}`,
  });
}

async function handleDownload(req, res, id) {
  const transfer = await findActiveTransfer(id);
  if (transfer === "expired") {
    sendPlain(res, 410, "Este link expiro.");
    return;
  }
  if (!transfer) {
    sendPlain(res, 404, "Archivo no encontrado.");
    return;
  }

  const filePath = path.join(STORAGE_DIR, transfer.storedName);
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    await removeTransfer(id, "missing");
    sendPlain(res, 404, "Archivo no encontrado.");
    return;
  }

  const range = parseRange(req.headers.range, stat.size);
  const shouldCountDownload = req.method !== "HEAD" && (!range || range.start === 0);
  if (shouldCountDownload && hasReachedDownloadLimit(transfer)) {
    await removeTransfer(id, "download-limit");
    sendPlain(res, 410, "Este link ya alcanzo su limite de descargas.");
    return;
  }

  if (range && range.invalid) {
    res.writeHead(416, {
      "Content-Range": `bytes */${stat.size}`,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  if (shouldCountDownload) {
    transfer.downloadCount += 1;
    transfer.lastDownloadedAt = Date.now();
    saveTransfers().catch(() => {});

    if (transfer.deleteAfterMaxDownloads && hasReachedDownloadLimit(transfer)) {
      res.once("finish", () => {
        removeTransfer(id, "download-limit").catch(() => {});
      });
    }
  }

  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": transfer.mime || "application/octet-stream",
    "Content-Disposition": contentDisposition(transfer.originalName),
  };

  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers["Content-Length"] = range.end - range.start + 1;
    res.writeHead(206, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
  } else {
    headers["Content-Length"] = stat.size;
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  }

}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { invalid: true };

  let start;
  let end;
  if (match[1] === "" && match[2] === "") return { invalid: true };

  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return { invalid: true };
  }

  return { start, end: Math.min(end, size - 1) };
}

async function findActiveTransfer(id) {
  const transfer = transfers.get(id);
  if (!transfer) return null;
  if (Date.now() >= transfer.expiresAt) {
    await removeTransfer(id, "expired");
    return "expired";
  }
  return transfer;
}

async function cleanupExpired() {
  const now = Date.now();
  const expired = [...transfers.values()].filter((transfer) => transfer.expiresAt <= now);
  if (!expired.length) return;

  for (const transfer of expired) {
    await removeTransfer(transfer.id, "expired");
  }
}

async function removeTransfer(id, reason = "manual") {
  const transfer = transfers.get(id);
  if (!transfer) return false;
  transfers.delete(id);
  await fsp.rm(path.join(STORAGE_DIR, transfer.storedName), { force: true });
  await archiveTransfer(transfer, reason);
  await saveTransfers();
  return true;
}

function loadTransfers() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((transfer) => transfer && transfer.id && transfer.storedName);
  } catch {
    return [];
  }
}

function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.id);
  } catch {
    return [];
  }
}

async function saveTransfers() {
  const records = [...transfers.values()].sort((a, b) => b.uploadedAt - a.uploadedAt);
  const tempPath = `${DB_PATH}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  await fsp.rename(tempPath, DB_PATH);
}

async function saveHistory() {
  history = history
    .sort((a, b) => (b.removedAt || 0) - (a.removedAt || 0))
    .slice(0, 500);
  const tempPath = `${HISTORY_PATH}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  await fsp.rename(tempPath, HISTORY_PATH);
}

async function archiveTransfer(transfer, reason) {
  history = history.filter((item) => item.id !== transfer.id);
  history.unshift({
    ...publicTransfer(transfer),
    removedAt: Date.now(),
    removalReason: reason,
  });
  await saveHistory();
}

function publicTransfer(transfer) {
  return {
    id: transfer.id,
    name: transfer.originalName,
    size: transfer.size,
    mime: transfer.mime,
    uploadedAt: transfer.uploadedAt,
    expiresAt: transfer.expiresAt,
    ttlMs: transfer.ttlMs || Math.max(0, transfer.expiresAt - transfer.uploadedAt),
    maxDownloads: transfer.maxDownloads ?? null,
    deleteAfterMaxDownloads: Boolean(transfer.deleteAfterMaxDownloads),
    downloadCount: transfer.downloadCount || 0,
    lastDownloadedAt: transfer.lastDownloadedAt || null,
  };
}

async function buildStats() {
  const activeTransfers = [...transfers.values()].sort((a, b) => b.uploadedAt - a.uploadedAt);
  const activeBytes = activeTransfers.reduce((sum, transfer) => sum + (Number(transfer.size) || 0), 0);
  const activeDownloads = activeTransfers.reduce((sum, transfer) => sum + (Number(transfer.downloadCount) || 0), 0);
  const historyDownloads = history.reduce((sum, transfer) => sum + (Number(transfer.downloadCount) || 0), 0);
  const lastDownloadedAt = [...activeTransfers, ...history]
    .map((transfer) => Number(transfer.lastDownloadedAt) || 0)
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;

  return {
    summary: {
      activeCount: activeTransfers.length,
      activeBytes,
      totalDownloads: activeDownloads + historyDownloads,
      historyCount: history.length,
      lastDownloadedAt,
    },
    storage: await getStorageStats(activeBytes),
    transfers: activeTransfers.map(publicTransfer),
    history: history.slice(0, 50),
  };
}

async function getStorageStats(activeBytes) {
  const stats = {
    activeBytes,
    freeBytes: null,
    totalBytes: null,
  };

  try {
    const stat = await fsp.statfs(STORAGE_DIR);
    stats.freeBytes = Number(stat.bavail) * Number(stat.bsize);
    stats.totalBytes = Number(stat.blocks) * Number(stat.bsize);
  } catch {}

  return stats;
}

function resolveUploadTtl(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_TTL_MS;

  const ttlMs = Number(value);
  if (!Number.isFinite(ttlMs)) {
    const error = new Error("El tiempo del link no es valido.");
    error.statusCode = 400;
    return error;
  }

  if (ttlMs < MIN_TTL_MS) {
    const error = new Error(`El tiempo minimo del link es ${formatDurationLabel(MIN_TTL_MS)}.`);
    error.statusCode = 400;
    return error;
  }

  if (ttlMs > MAX_TTL_MS) {
    const error = new Error(`El tiempo maximo del link es ${formatDurationLabel(MAX_TTL_MS)}.`);
    error.statusCode = 400;
    return error;
  }

  return Math.round(ttlMs);
}

function resolveMaxDownloads(value) {
  if (value === undefined || value === null || value === "" || value === "0") return null;

  const maxDownloads = Number(value);
  if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > 100000) {
    const error = new Error("El limite de descargas no es valido.");
    error.statusCode = 400;
    return error;
  }

  return maxDownloads;
}

function clampTtl(value) {
  if (!Number.isFinite(value)) return 60 * 60 * 1000;
  return Math.max(MIN_TTL_MS, Math.min(Math.round(value), MAX_TTL_MS));
}

function hasReachedDownloadLimit(transfer) {
  return Number.isInteger(transfer.maxDownloads) && transfer.downloadCount >= transfer.maxDownloads;
}

function parseBoolean(value) {
  return ["1", "true", "yes", "si", "on"].includes(String(value || "").trim().toLowerCase());
}

function requireUploadCode(req, res) {
  const provided = req.headers["x-upload-code"];
  if (!isValidCode(provided)) {
    sendJson(req, res, 401, { error: "Codigo privado incorrecto." });
    return false;
  }
  return true;
}

function isValidCode(value) {
  const provided = Buffer.from(String(value || "").trim());
  const expected = Buffer.from(uploadCode);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

function readOrCreateUploadCode() {
  const envCode = String(process.env.FILEDROP_CODE || process.env.SHARE_CODE || "").trim();
  if (envCode) return envCode;

  try {
    const existing = fs.readFileSync(CODE_PATH, "utf8").trim();
    if (existing) return existing;
  } catch {}

  const code = generateHumanCode();
  fs.writeFileSync(CODE_PATH, `${code}\n`, { encoding: "utf8", flag: "wx" });
  return code;
}

function generateHumanCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

async function readJson(req, maxBytes) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error("Solicitud demasiado grande.");
      error.statusCode = 413;
      throw error;
    }
  }
  return body ? JSON.parse(body) : {};
}

async function serveFile(req, res, filePath, cacheControl) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) {
    sendNotFound(req, res);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": cacheControl,
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(req, res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") res.end();
  else res.end(body);
}

function sendPlain(res, status, message) {
  const body = `${message}\n`;
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendNotFound(req, res) {
  if (req.url && req.url.startsWith("/api/")) {
    sendJson(req, res, 404, { error: "Ruta no encontrada." });
    return;
  }
  sendPlain(res, 404, "No encontrado.");
}

function addBaseHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function currentOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const proto = forwardedProto || "http";
  const host = forwardedHost || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function localOrigins(req) {
  const fromRequest = req ? [currentOrigin(req)] : [`http://localhost:${PORT}`];
  const origins = new Set(fromRequest);
  origins.add(`http://localhost:${PORT}`);

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        origins.add(`http://${entry.address}:${PORT}`);
      }
    }
  }

  return [...origins];
}

function readPublicOrigin() {
  try {
    const value = fs.readFileSync(PUBLIC_ORIGIN_PATH, "utf8").trim();
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function sanitizeOriginalName(headerValue) {
  let value = "archivo";
  try {
    value = decodeURIComponent(String(headerValue || "").trim()) || value;
  } catch {
    value = String(headerValue || "").trim() || value;
  }

  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220) || "archivo";
}

function contentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(filename)}`;
}

function encodeRFC5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function parseByteSize(input) {
  if (typeof input === "number") return input;
  const match = String(input).trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
  if (!match) return 5 * 1024 ** 3;
  const value = Number(match[1]);
  const unit = (match[2] || "b").toLowerCase();
  const multipliers = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
  };
  return Math.floor(value * multipliers[unit]);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDurationLabel(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes} ${totalMinutes === 1 ? "minuto" : "minutos"}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourText = `${hours} ${hours === 1 ? "hora" : "horas"}`;
  if (!minutes) return hourText;
  return `${hourText} ${minutes} min`;
}
