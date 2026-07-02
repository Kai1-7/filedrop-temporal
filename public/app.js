"use strict";

const state = {
  code: sessionStorage.getItem("filedrop:code") || "",
  info: null,
  selectedFile: null,
  transfers: [],
  downloadTransfer: null,
  durationInitialized: false,
};

const els = {
  adminView: document.querySelector("#adminView"),
  downloadView: document.querySelector("#downloadView"),
  lockPanel: document.querySelector("#lockPanel"),
  uploadPanel: document.querySelector("#uploadPanel"),
  codeForm: document.querySelector("#codeForm"),
  codeInput: document.querySelector("#codeInput"),
  codeError: document.querySelector("#codeError"),
  durationPill: document.querySelector("#durationPill"),
  logoutButton: document.querySelector("#logoutButton"),
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  durationSelect: document.querySelector("#durationSelect"),
  customDurationWrap: document.querySelector("#customDurationWrap"),
  customDurationInput: document.querySelector("#customDurationInput"),
  chooseButton: document.querySelector("#chooseButton"),
  uploadButton: document.querySelector("#uploadButton"),
  fileName: document.querySelector("#fileName"),
  fileMeta: document.querySelector("#fileMeta"),
  progressPanel: document.querySelector("#progressPanel"),
  progressBar: document.querySelector("#progressBar"),
  progressText: document.querySelector("#progressText"),
  speedText: document.querySelector("#speedText"),
  resultPanel: document.querySelector("#resultPanel"),
  shareLink: document.querySelector("#shareLink"),
  copyButton: document.querySelector("#copyButton"),
  resultNote: document.querySelector("#resultNote"),
  uploadStatus: document.querySelector("#uploadStatus"),
  refreshButton: document.querySelector("#refreshButton"),
  transferList: document.querySelector("#transferList"),
  networkHints: document.querySelector("#networkHints"),
  downloadTitle: document.querySelector("#downloadTitle"),
  downloadSize: document.querySelector("#downloadSize"),
  downloadTime: document.querySelector("#downloadTime"),
  downloadButton: document.querySelector("#downloadButton"),
  downloadStatus: document.querySelector("#downloadStatus"),
};

const downloadId = getDownloadId();

init();

async function init() {
  state.info = await getInfo();

  if (downloadId) {
    els.downloadView.hidden = false;
    await loadDownload(downloadId);
  } else {
    els.adminView.hidden = false;
    setupAdminEvents();
    renderInfo();
    if (state.code) await unlockWithCode(state.code, false);
  }

  setInterval(updateTimers, 1000);
}

function setupAdminEvents() {
  els.codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await unlockWithCode(els.codeInput.value, true);
  });

  els.logoutButton.addEventListener("click", () => {
    state.code = "";
    sessionStorage.removeItem("filedrop:code");
    els.uploadPanel.hidden = true;
    els.lockPanel.hidden = false;
    els.codeInput.value = "";
    els.codeInput.focus();
  });

  els.chooseButton.addEventListener("click", () => els.fileInput.click());
  els.dropZone.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => selectFile(els.fileInput.files[0]));
  els.durationSelect.addEventListener("change", renderDurationControls);
  els.customDurationInput.addEventListener("input", renderDurationControls);
  els.uploadButton.addEventListener("click", uploadSelectedFile);
  els.refreshButton.addEventListener("click", refreshTransfers);
  els.copyButton.addEventListener("click", () => copyText(els.shareLink.value, els.resultNote));

  for (const eventName of ["dragenter", "dragover"]) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragging");
    });
  }

  els.dropZone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    selectFile(file);
  });
}

async function unlockWithCode(code, showErrors) {
  els.codeError.textContent = "";
  const cleanCode = String(code || "").trim();
  if (!cleanCode) return;

  try {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: cleanCode }),
    });
    if (!response.ok) throw new Error("Codigo incorrecto.");
    state.code = cleanCode;
    sessionStorage.setItem("filedrop:code", state.code);
    els.lockPanel.hidden = true;
    els.uploadPanel.hidden = false;
    await refreshTransfers();
  } catch (error) {
    sessionStorage.removeItem("filedrop:code");
    state.code = "";
    if (showErrors) els.codeError.textContent = error.message;
  }
}

function selectFile(file) {
  if (!file) return;
  state.selectedFile = file;
  els.fileName.textContent = file.name;
  els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || "archivo"}`;
  els.uploadButton.disabled = false;
  els.resultPanel.hidden = true;
  setStatus(els.uploadStatus, "");

  if (state.info && file.size > state.info.maxBytes) {
    els.uploadButton.disabled = true;
    setStatus(els.uploadStatus, `El archivo supera el maximo de ${state.info.maxSizeText}.`, true);
  }
}

function uploadSelectedFile() {
  const file = state.selectedFile;
  if (!file || !state.code) return;

  els.uploadButton.disabled = true;
  els.chooseButton.disabled = true;
  els.progressPanel.hidden = false;
  els.resultPanel.hidden = true;
  setProgress(0, "Preparando...");
  setStatus(els.uploadStatus, "");

  const startedAt = performance.now();
  const ttlMs = getSelectedTtlMs();
  if (!ttlMs) {
    setStatus(els.uploadStatus, "Elige una duracion valida para el link.", true);
    els.uploadButton.disabled = false;
    els.chooseButton.disabled = false;
    els.progressPanel.hidden = true;
    return;
  }

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/uploads");
  xhr.setRequestHeader("X-Upload-Code", state.code);
  xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
  xhr.setRequestHeader("X-File-Ttl-Ms", String(ttlMs));
  xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

  xhr.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    const seconds = Math.max((performance.now() - startedAt) / 1000, .1);
    const speed = event.loaded / seconds;
    const remaining = Math.max(event.total - event.loaded, 0);
    const eta = speed > 0 ? remaining / speed : 0;
    setProgress(percent, `${formatBytes(speed)}/s · ${formatDuration(eta)}`);
  });

  xhr.addEventListener("load", async () => {
    els.uploadButton.disabled = false;
    els.chooseButton.disabled = false;

    let data = {};
    try {
      data = JSON.parse(xhr.responseText || "{}");
    } catch {}

    if (xhr.status < 200 || xhr.status >= 300) {
      setStatus(els.uploadStatus, data.error || "No se pudo subir el archivo.", true);
      return;
    }

    state.info = await getInfo();
    const shareUrl = bestShareUrl(data.shareUrl, data.transfer.id);
    els.shareLink.value = shareUrl;
    els.resultPanel.hidden = false;
    setProgress(100, "Subida completa");
    setStatus(els.uploadStatus, "Link listo. Se borrara automaticamente al vencer.");
    setStatus(els.resultNote, `Disponible durante ${formatDurationLabel(data.transfer.ttlMs || ttlMs)} desde la subida.`);
    await copyText(shareUrl, els.uploadStatus, true);
    await refreshTransfers();
  });

  xhr.addEventListener("error", () => {
    els.uploadButton.disabled = false;
    els.chooseButton.disabled = false;
    setStatus(els.uploadStatus, "La conexion se interrumpio durante la subida.", true);
  });

  xhr.send(file);
}

async function refreshTransfers() {
  try {
    const response = await fetch("/api/transfers", {
      headers: { "X-Upload-Code": state.code },
    });
    if (response.status === 401) {
      sessionStorage.removeItem("filedrop:code");
      state.code = "";
      els.uploadPanel.hidden = true;
      els.lockPanel.hidden = false;
      return;
    }
    const data = await response.json();
    state.transfers = data.transfers || [];
    renderTransfers();
  } catch {
    els.transferList.innerHTML = `<p class="empty">No se pudieron cargar los links activos.</p>`;
  }
}

async function loadDownload(id) {
  try {
    const response = await fetch(`/api/transfers/${encodeURIComponent(id)}`);
    if (response.status === 410) {
      renderExpired();
      return;
    }
    if (!response.ok) throw new Error("Archivo no encontrado.");
    const data = await response.json();
    state.downloadTransfer = data.transfer;
    els.downloadTitle.textContent = data.transfer.name;
    els.downloadSize.textContent = formatBytes(data.transfer.size);
    els.downloadButton.href = `/download/${encodeURIComponent(id)}`;
    els.downloadButton.hidden = false;
    els.downloadStatus.textContent = "El link se cerrara automaticamente cuando venza.";
    updateTimers();
  } catch {
    els.downloadTitle.textContent = "Link no disponible";
    els.downloadSize.textContent = "-";
    els.downloadTime.textContent = "-";
    els.downloadButton.hidden = true;
    els.downloadStatus.textContent = "Puede que el archivo ya haya vencido o que el link este incompleto.";
  }
}

function renderExpired() {
  els.downloadTitle.textContent = "Link vencido";
  els.downloadSize.textContent = "-";
  els.downloadTime.textContent = "Expirado";
  els.downloadButton.hidden = true;
  els.downloadStatus.textContent = "El archivo ya fue limpiado por seguridad.";
}

function renderTransfers() {
  if (!state.transfers.length) {
    els.transferList.innerHTML = `<p class="empty">No hay links activos ahora.</p>`;
    return;
  }

  els.transferList.innerHTML = state.transfers.map((transfer) => {
    const shareUrl = bestShareUrl(`${location.origin}/d/${transfer.id}`, transfer.id);
    return `
      <article class="transfer-item" data-id="${escapeHtml(transfer.id)}">
        <div class="transfer-title">${escapeHtml(transfer.name)}</div>
        <div class="transfer-meta">
          <span>${formatBytes(transfer.size)}</span>
          <span data-expires="${transfer.expiresAt}">${timeLeft(transfer.expiresAt)}</span>
          <span>${transfer.downloadCount} descargas</span>
        </div>
        <div class="transfer-actions">
          <a href="${shareUrl}" target="_blank" rel="noreferrer">Abrir</a>
          <button type="button" data-copy="${shareUrl}">Copiar</button>
          <button class="danger" type="button" data-delete="${escapeHtml(transfer.id)}">Borrar</button>
        </div>
      </article>
    `;
  }).join("");

  els.transferList.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copy, els.uploadStatus));
  });

  els.transferList.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteTransfer(button.dataset.delete);
    });
  });
}

async function deleteTransfer(id) {
  try {
    const response = await fetch(`/api/transfers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-Upload-Code": state.code },
    });
    if (!response.ok) throw new Error();
    await refreshTransfers();
    setStatus(els.uploadStatus, "Archivo borrado.");
  } catch {
    setStatus(els.uploadStatus, "No se pudo borrar ese archivo.", true);
  }
}

function renderInfo() {
  if (!state.info) return;
  els.fileMeta.textContent = `Maximo permitido: ${state.info.maxSizeText}`;
  initializeDurationFromInfo();
  renderDurationControls();

  const publicOrigin = state.info.publicOrigin;
  const lan = (state.info.localOrigins || [])
    .filter((origin, index, list) => list.indexOf(origin) === index)
    .filter((origin) => origin !== location.origin);

  if (!lan.length && !publicOrigin) {
    els.networkHints.innerHTML = "";
    return;
  }

  els.networkHints.innerHTML = `
    <strong>${publicOrigin ? "Link publico activo" : "Acceso en tu red"}</strong>
    ${publicOrigin ? `<a href="${publicOrigin}" target="_blank" rel="noreferrer">${publicOrigin}</a>` : ""}
    ${lan.slice(0, 3).map((origin) => `<a href="${origin}" target="_blank" rel="noreferrer">${origin}</a>`).join("")}
  `;
}

function initializeDurationFromInfo() {
  if (state.durationInitialized || !state.info) return;
  state.durationInitialized = true;

  const defaultTtl = String(state.info.defaultTtlMs || state.info.ttlMs || 3600000);
  const option = [...els.durationSelect.options].find((item) => item.value === defaultTtl);
  if (option) {
    els.durationSelect.value = defaultTtl;
    return;
  }

  els.durationSelect.value = "custom";
  els.customDurationInput.value = String(Math.max(1, Math.round(Number(defaultTtl) / 60000)));
}

function renderDurationControls() {
  const custom = els.durationSelect.value === "custom";
  els.customDurationWrap.hidden = !custom;

  if (state.info) {
    const maxMinutes = Math.max(1, Math.floor(state.info.maxTtlMs / 60000));
    els.customDurationInput.max = String(maxMinutes);
  }

  const ttlMs = getSelectedTtlMs();
  const label = ttlMs ? formatDurationLabel(ttlMs) : "Tiempo invalido";
  els.durationPill.textContent = label;

  const maxTtl = state.info ? state.info.maxTtlMs : Infinity;
  if (ttlMs && ttlMs > maxTtl) {
    setStatus(els.uploadStatus, `El maximo permitido es ${formatDurationLabel(maxTtl)}.`, true);
  } else if (els.uploadStatus.classList.contains("error") && els.uploadStatus.textContent.includes("maximo permitido")) {
    setStatus(els.uploadStatus, "");
  }
}

function updateTimers() {
  if (state.downloadTransfer) {
    const left = timeLeft(state.downloadTransfer.expiresAt);
    els.downloadTime.textContent = left;
    if (Date.now() >= state.downloadTransfer.expiresAt) renderExpired();
  }

  document.querySelectorAll("[data-expires]").forEach((node) => {
    node.textContent = timeLeft(Number(node.dataset.expires));
  });
}

async function getInfo() {
  try {
    const response = await fetch("/api/info");
    return await response.json();
  } catch {
    return null;
  }
}

function getDownloadId() {
  const match = location.pathname.match(/^\/d\/([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

function bestShareUrl(currentUrl, id) {
  if (!state.info) return currentUrl;
  if (state.info.publicOrigin) {
    return `${state.info.publicOrigin}/d/${id}`;
  }
  if (!/^localhost$|^127\.0\.0\.1$/.test(location.hostname)) return currentUrl;
  const candidates = (state.info.localOrigins || []).filter((origin) => {
    try {
      const host = new URL(origin).hostname;
      return host !== "localhost" && host !== "127.0.0.1";
    } catch {
      return false;
    }
  });

  const privateLan = candidates.find((origin) => isPrivateLanHost(new URL(origin).hostname));
  const lanOrigin = privateLan || candidates[0];
  return lanOrigin ? `${lanOrigin}/d/${id}` : currentUrl;
}

function getSelectedTtlMs() {
  const rawValue = els.durationSelect.value;
  const ttlMs = rawValue === "custom"
    ? Number(els.customDurationInput.value) * 60 * 1000
    : Number(rawValue);

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return null;

  const minTtl = state.info ? state.info.minTtlMs : 60 * 1000;
  const maxTtl = state.info ? state.info.maxTtlMs : 24 * 60 * 60 * 1000;
  if (ttlMs < minTtl || ttlMs > maxTtl) return null;
  return Math.round(ttlMs);
}

function isLocalLikeHost(host) {
  return host === "localhost" || host === "127.0.0.1" || isPrivateLanHost(host);
}

function isPrivateLanHost(host) {
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  const parts = host.split(".").map(Number);
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

async function copyText(text, statusNode, quiet = false) {
  try {
    await navigator.clipboard.writeText(text);
    if (!quiet) setStatus(statusNode, "Link copiado.");
    else setStatus(statusNode, "Link copiado automaticamente.");
  } catch {
    if (statusNode) setStatus(statusNode, "Selecciona el link y copialo manualmente.");
  }
}

function setProgress(percent, label) {
  els.progressBar.style.width = `${Math.max(0, Math.min(percent, 100))}%`;
  els.progressText.textContent = `${percent}%`;
  els.speedText.textContent = label;
}

function setStatus(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", Boolean(isError));
}

function timeLeft(expiresAt) {
  const ms = Math.max(0, Number(expiresAt) - Date.now());
  if (ms <= 0) return "Expirado";
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.ceil(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatDurationLabel(ms) {
  const totalMinutes = Math.max(1, Math.round(Number(ms) / 60000));
  if (totalMinutes < 60) return `${totalMinutes} ${totalMinutes === 1 ? "minuto" : "minutos"}`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourText = `${hours} ${hours === 1 ? "hora" : "horas"}`;
  return minutes ? `${hourText} ${minutes} min` : hourText;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
