#!/usr/bin/env node
"use strict";

const { app, BrowserWindow, clipboard, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DESKTOP_DIR = __dirname;
const APP_DIR = path.resolve(DESKTOP_DIR, "..");
const ROOT_DIR = APP_DIR;
const SERVER_PATH = path.join(APP_DIR, "server.js");
const PUBLIC_ORIGIN_PATH = path.join(APP_DIR, "public-origin.txt");
const LOCAL_CLOUDFLARED_PATH = path.join(APP_DIR, "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");

const PORT = Number(process.env.PORT || 8787);
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const TUNNEL_RE = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/i;

let mainWindow = null;
let serverProcess = null;
let tunnelProcess = null;
let publicOrigin = readPublicOrigin();
let logs = [];
let stopping = false;
let serverActive = false;

app.whenReady().then(async () => {
  createWindow();
  wireIpc();
  serverActive = await isServerReady();
  await publishStatus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (stopping) return;
  event.preventDefault();
  await stopAll();
  stopping = true;
  app.quit();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    title: "FileDrop Temporal",
    backgroundColor: "#f7f7f2",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(DESKTOP_DIR, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(DESKTOP_DIR, "index.html"));
}

function wireIpc() {
  ipcMain.handle("filedrop:status", getStatus);

  ipcMain.handle("filedrop:start", async () => {
    await startServer();
    await startTunnel();
    return getStatus();
  });

  ipcMain.handle("filedrop:stop", async () => {
    await stopAll();
    return getStatus();
  });

  ipcMain.handle("filedrop:openLocal", async () => {
    await startServer();
    await shell.openExternal(LOCAL_URL);
    return getStatus();
  });

  ipcMain.handle("filedrop:copyPublic", () => {
    if (publicOrigin) clipboard.writeText(publicOrigin);
    return getStatus();
  });

  ipcMain.handle("filedrop:clearLogs", () => {
    logs = [];
    return getStatus();
  });
}

async function startServer() {
  if (await isServerReady()) {
    serverActive = true;
    appendLog("Servidor local listo");
    return;
  }

  if (serverProcess) return;

  appendLog("Encendiendo servidor local...");
  serverProcess = spawn("node", [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverProcess.stdout.on("data", (buffer) => appendLog(buffer.toString()));
  serverProcess.stderr.on("data", (buffer) => appendLog(buffer.toString()));
  serverProcess.on("exit", (code) => {
    serverProcess = null;
    serverActive = false;
    appendLog(`Servidor local cerrado (${code ?? 0})`);
    publishStatus();
  });

  await waitForServer();
}

async function startTunnel() {
  if (tunnelProcess) {
    appendLog("Tunel publico ya esta activo");
    return;
  }

  const cloudflared = fs.existsSync(LOCAL_CLOUDFLARED_PATH) ? LOCAL_CLOUDFLARED_PATH : "cloudflared";
  appendLog("Abriendo tunel publico...");

  tunnelProcess = spawn(cloudflared, ["tunnel", "--url", LOCAL_URL], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  tunnelProcess.stdout.on("data", handleTunnelOutput);
  tunnelProcess.stderr.on("data", handleTunnelOutput);
  tunnelProcess.on("error", (error) => {
    tunnelProcess = null;
    appendLog(`No se pudo abrir cloudflared: ${error.message}`);
    publishStatus();
  });
  tunnelProcess.on("exit", (code) => {
    tunnelProcess = null;
    appendLog(`Tunel publico cerrado (${code ?? 0})`);
    publishStatus();
  });
}

function handleTunnelOutput(buffer) {
  const text = buffer.toString();
  appendLog(text);

  const match = text.match(TUNNEL_RE);
  if (!match) return;

  publicOrigin = match[0];
  fs.writeFileSync(PUBLIC_ORIGIN_PATH, `${publicOrigin}\n`, "utf8");
  appendLog(`Link publico activo: ${publicOrigin}`);
  publishStatus();
}

async function stopAll() {
  await fsp.rm(PUBLIC_ORIGIN_PATH, { force: true });
  publicOrigin = "";

  if (tunnelProcess && !tunnelProcess.killed) tunnelProcess.kill();
  if (serverProcess && !serverProcess.killed) serverProcess.kill();

  tunnelProcess = null;
  serverProcess = null;
  serverActive = false;
  appendLog("FileDrop apagado");
  await publishStatus();
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (await isServerReady()) {
      serverActive = true;
      appendLog("Servidor local listo");
      await publishStatus();
      return;
    }
    await delay(250);
  }
  throw new Error("No se pudo iniciar el servidor local.");
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

function getStatus() {
  return {
    localUrl: LOCAL_URL,
    publicOrigin,
    serverRunning: serverActive || Boolean(serverProcess),
    tunnelRunning: Boolean(tunnelProcess),
    logs: logs.slice(-120),
  };
}

function appendLog(value) {
  const lines = String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return;

  for (const line of lines) {
    logs.push(`[${new Date().toLocaleTimeString()}] ${line}`);
  }
  logs = logs.slice(-160);
  publishStatus();
}

async function publishStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("filedrop:status", getStatus());
}

function readPublicOrigin() {
  try {
    const value = fs.readFileSync(PUBLIC_ORIGIN_PATH, "utf8").trim();
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
