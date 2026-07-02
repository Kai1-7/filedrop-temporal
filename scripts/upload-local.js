#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const APP_DIR = path.resolve(__dirname, "..");
const CODE_PATH = path.join(APP_DIR, ".upload-code");
const PUBLIC_ORIGIN_PATH = path.join(APP_DIR, "public-origin.txt");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.FILEDROP_HOST || "127.0.0.1";

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Uso: node apps/filedrop/upload-local.js <archivo>");
  }

  const absolutePath = path.resolve(filePath);
  const stat = await fsp.stat(absolutePath);
  if (!stat.isFile()) throw new Error("La ruta no apunta a un archivo.");

  const code = (process.env.FILEDROP_CODE || await fsp.readFile(CODE_PATH, "utf8")).trim();
  const fileName = path.basename(absolutePath);
  const startedAt = Date.now();
  let sent = 0;
  let lastReport = 0;

  const result = await new Promise((resolve, reject) => {
    const request = http.request({
      host: HOST,
      port: PORT,
      path: "/api/uploads",
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": stat.size,
        "X-Upload-Code": code,
        "X-File-Name": encodeURIComponent(fileName),
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Subida fallida HTTP ${response.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Respuesta invalida: ${body}`));
        }
      });
    });

    request.on("error", reject);

    const stream = fs.createReadStream(absolutePath);
    stream.on("data", (chunk) => {
      sent += chunk.length;
      const now = Date.now();
      if (now - lastReport >= 5000) {
        lastReport = now;
        const percent = ((sent / stat.size) * 100).toFixed(1);
        const seconds = Math.max((now - startedAt) / 1000, 0.1);
        const speed = sent / seconds;
        console.error(`${percent}% (${formatBytes(sent)} de ${formatBytes(stat.size)}) a ${formatBytes(speed)}/s`);
      }
    });
    stream.on("error", reject);
    stream.pipe(request);
  });

  const publicOrigin = await readPublicOrigin();
  if (publicOrigin && result.transfer && result.transfer.id) {
    result.shareUrl = `${publicOrigin}/d/${result.transfer.id}`;
    result.downloadUrl = `${publicOrigin}/download/${result.transfer.id}`;
  }

  console.log(JSON.stringify(result, null, 2));
}

async function readPublicOrigin() {
  try {
    const value = (await fsp.readFile(PUBLIC_ORIGIN_PATH, "utf8")).trim();
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
