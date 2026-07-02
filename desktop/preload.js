"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("filedrop", {
  status: () => ipcRenderer.invoke("filedrop:status"),
  start: () => ipcRenderer.invoke("filedrop:start"),
  stop: () => ipcRenderer.invoke("filedrop:stop"),
  openLocal: () => ipcRenderer.invoke("filedrop:openLocal"),
  copyPublic: () => ipcRenderer.invoke("filedrop:copyPublic"),
  clearLogs: () => ipcRenderer.invoke("filedrop:clearLogs"),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("filedrop:status", listener);
    return () => ipcRenderer.removeListener("filedrop:status", listener);
  },
});
