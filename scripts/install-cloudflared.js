#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");
const { spawn } = require("node:child_process");

const APP_DIR = path.resolve(__dirname, "..");
const BIN_DIR = path.join(APP_DIR, "bin");
const TARGET = path.join(BIN_DIR, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");

const DOWNLOADS = {
  "win32-x64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
  "darwin-x64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
  "darwin-arm64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
  "linux-x64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
  "linux-arm64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  const key = `${process.platform}-${process.arch}`;
  const url = DOWNLOADS[key];
  if (!url) {
    throw new Error(`No tengo descarga automatica para ${key}. Instala cloudflared manualmente desde Cloudflare.`);
  }

  await fsp.mkdir(BIN_DIR, { recursive: true });

  if (fs.existsSync(TARGET)) {
    console.log("cloudflared ya existe en:");
    console.log(`  ${TARGET}`);
    await printVersion();
    return;
  }

  if (url.endsWith(".tgz")) {
    throw new Error([
      "Para macOS es mejor instalar cloudflared con Homebrew:",
      "  brew install cloudflared",
      "",
      "Luego corre:",
      "  npm run filedrop:tunnel",
    ].join("\n"));
  }

  console.log("Descargando cloudflared para usarlo solo en esta app...");
  console.log(`  ${url}`);

  const tempPath = `${TARGET}.download`;
  await download(url, tempPath, 0);
  await fsp.rename(tempPath, TARGET);

  if (process.platform !== "win32") {
    await fsp.chmod(TARGET, 0o755);
  }

  console.log("");
  console.log("Listo. Ahora puedes correr:");
  console.log("  npm run tunnel");
  await printVersion();
}

function download(url, targetPath, redirects) {
  if (redirects > 5) return Promise.reject(new Error("Demasiadas redirecciones al descargar cloudflared."));

  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        download(nextUrl, targetPath, redirects + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Descarga fallida: HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(targetPath);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

function printVersion() {
  return new Promise((resolve) => {
    const child = spawn(TARGET, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (buffer) => process.stdout.write(buffer));
    child.stderr.on("data", (buffer) => process.stdout.write(buffer));
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}
