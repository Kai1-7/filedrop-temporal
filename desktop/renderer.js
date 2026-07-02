"use strict";

const els = {
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  openButton: document.querySelector("#openButton"),
  copyButton: document.querySelector("#copyButton"),
  clearButton: document.querySelector("#clearButton"),
  serverState: document.querySelector("#serverState"),
  tunnelState: document.querySelector("#tunnelState"),
  publicUrl: document.querySelector("#publicUrl"),
  uploaderFrame: document.querySelector("#uploaderFrame"),
  emptyState: document.querySelector("#emptyState"),
  logs: document.querySelector("#logs"),
};

let lastPublicOrigin = "";
let busy = false;

wireEvents();
window.filedrop.onStatus(renderStatus);
window.filedrop.status().then(renderStatus);

function wireEvents() {
  els.startButton.addEventListener("click", () => runAction(window.filedrop.start));
  els.stopButton.addEventListener("click", () => runAction(window.filedrop.stop));
  els.openButton.addEventListener("click", () => runAction(window.filedrop.openLocal));
  els.copyButton.addEventListener("click", () => runAction(window.filedrop.copyPublic));
  els.clearButton.addEventListener("click", () => runAction(window.filedrop.clearLogs));
}

async function runAction(action) {
  if (busy) return;
  busy = true;
  setBusy(true);
  try {
    renderStatus(await action());
  } finally {
    busy = false;
    setBusy(false);
  }
}

function renderStatus(status) {
  const serverOn = Boolean(status.serverRunning);
  const tunnelOn = Boolean(status.tunnelRunning);

  els.serverState.textContent = serverOn ? "Activo" : "Apagado";
  els.tunnelState.textContent = tunnelOn ? "Activo" : "Apagado";
  els.publicUrl.value = status.publicOrigin || "Sin tunel activo";
  els.logs.textContent = (status.logs || []).join("\n");
  els.logs.scrollTop = els.logs.scrollHeight;

  if (serverOn) {
    const url = status.localUrl || "http://127.0.0.1:8787";
    const shouldLoad = !els.uploaderFrame.src || els.uploaderFrame.src === "about:blank";
    const publicChanged = status.publicOrigin && status.publicOrigin !== lastPublicOrigin;
    if (shouldLoad || publicChanged) {
      els.uploaderFrame.src = `${url}/?desktop=${Date.now()}`;
    }
    els.emptyState.hidden = true;
  } else {
    els.uploaderFrame.src = "about:blank";
    els.emptyState.hidden = false;
  }

  lastPublicOrigin = status.publicOrigin || "";
}

function setBusy(value) {
  els.startButton.disabled = value;
  els.stopButton.disabled = value;
  els.openButton.disabled = value;
  els.copyButton.disabled = value;
  els.clearButton.disabled = value;
}
