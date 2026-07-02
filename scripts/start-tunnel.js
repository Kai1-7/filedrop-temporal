#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const APP_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = APP_DIR;
const SERVER_PATH = path.join(APP_DIR, "server.js");
const CODE_PATH = path.join(APP_DIR, ".upload-code");
const PUBLIC_ORIGIN_PATH = path.join(APP_DIR, "public-origin.txt");
const LOCAL_CLOUDFLARED_PATH = path.join(APP_DIR, "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");

const PORT = Number(process.env.PORT || 8787);
const LOCAL_URL = `http://localhost:${PORT}`;
const TUNNEL_RE = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/i;
let cloudflaredCommand = "cloudflared";

let serverProcess = null;
let tunnelProcess = null;
let shuttingDown = false;

main().catch(async (error) => {
  console.error(error.message || error);
  await shutdown(1);
});

async function main() {
  await ensureCloudflared();
  await fsp.rm(PUBLIC_ORIGIN_PATH, { force: true });

  const alreadyRunning = await isServerReady();
  if (!alreadyRunning) {
    serverProcess = spawn(process.execPath, [SERVER_PATH], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: process.env.HOST || "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    pipeServerOutput(serverProcess.stdout);
    pipeServerOutput(serverProcess.stderr);
    await waitForServer();
  }

  const code = await readUploadCode();
  console.log("");
  console.log("Abriendo tunel publico temporal...");
  console.log("Deja esta ventana abierta mientras tu amigo descarga.");
  console.log("");

  tunnelProcess = spawn(cloudflaredCommand, ["tunnel", "--url", LOCAL_URL], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  tunnelProcess.stdout.on("data", handleTunnelOutput);
  tunnelProcess.stderr.on("data", handleTunnelOutput);
  tunnelProcess.on("exit", async (codeValue) => {
    if (!shuttingDown) {
      console.log("");
      console.log("El tunel se cerro.");
      await shutdown(codeValue || 0);
    }
  });

  if (alreadyRunning) {
    console.log(`Servidor local detectado en ${LOCAL_URL}`);
    if (code) console.log(`Codigo privado: ${code}`);
  }
}

function handleTunnelOutput(buffer) {
  const text = buffer.toString();
  process.stdout.write(text);

  const match = text.match(TUNNEL_RE);
  if (!match) return;

  const publicOrigin = match[0];
  fs.writeFileSync(PUBLIC_ORIGIN_PATH, `${publicOrigin}\n`, "utf8");

  console.log("");
  console.log("Listo. Sube el archivo desde tu PC aqui:");
  console.log(`  ${LOCAL_URL}`);
  console.log("");
  console.log("La app generara links publicos usando este tunel:");
  console.log(`  ${publicOrigin}`);
  console.log("");
  console.log("Flujo:");
  console.log(`  1. Abre ${LOCAL_URL} en tu PC.`);
  console.log("  2. Entra con tu codigo privado.");
  console.log("  3. Sube el archivo.");
  console.log("  4. Copia el link generado y mandaselo a tu amigo.");
  console.log("");
}

async function ensureCloudflared() {
  if (fs.existsSync(LOCAL_CLOUDFLARED_PATH)) {
    cloudflaredCommand = LOCAL_CLOUDFLARED_PATH;
  }

  await new Promise((resolve, reject) => {
    const child = spawn(cloudflaredCommand, ["--version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {
      reject(new Error([
        "Falta instalar Cloudflare Tunnel (cloudflared).",
        "",
        "Opcion facil dentro del proyecto:",
        "  npm run filedrop:setup-tunnel",
        "",
        "O instalalo en Windows con:",
        "  winget install --id Cloudflare.cloudflared --source winget",
        "",
        "Despues corre:",
        "  npm run filedrop:tunnel",
      ].join("\n")));
    });
    child.on("exit", (codeValue) => {
      if (codeValue === 0) resolve();
      else reject(new Error("cloudflared esta instalado, pero no respondio correctamente."));
    });
  });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (await isServerReady()) return;
    await delay(250);
  }
  throw new Error(`No se pudo iniciar el servidor local en ${LOCAL_URL}.`);
}

async function isServerReady() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const response = await fetch(`${LOCAL_URL}/api/info`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function readUploadCode() {
  try {
    return (await fsp.readFile(CODE_PATH, "utf8")).trim();
  } catch {
    return "";
  }
}

function pipeServerOutput(stream) {
  stream.on("data", (buffer) => {
    const text = buffer.toString();
    if (text.trim()) process.stdout.write(text);
  });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  await fsp.rm(PUBLIC_ORIGIN_PATH, { force: true });
  if (tunnelProcess && !tunnelProcess.killed) tunnelProcess.kill();
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  process.exit(exitCode);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
