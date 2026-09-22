const { contextBridge, ipcRenderer } = require("electron");

// Allowed update methods - restrict to safe operations only
const ALLOWED_UPDATE_METHODS = new Set([
  "update.check",
  "update.download",
  "update.install",
  "update.dismiss",
  "update.retry",
]);

contextBridge.exposeInMainWorld("anybot", {
  request: (method, payload) =>
    ipcRenderer.invoke("anybot:request", method, payload),
  chooseDirectory: () => ipcRenderer.invoke("anybot:directory"),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("anybot:changed", listener);
    return () => ipcRenderer.removeListener("anybot:changed", listener);
  },
  listDirectory: (path) => ipcRenderer.invoke("anybot:listDirectory", path),
  revealPath: (path) => ipcRenderer.invoke("anybot:revealPath", path),
  runCommand: (command, onOutput) => {
    const id = Math.random().toString(36).slice(2);
    const outputListener = (_event, data) => {
      if (data.id === id && data.chunk) {
        onOutput?.(data.chunk);
      }
    };
    ipcRenderer.on("anybot:commandOutput", outputListener);
    return ipcRenderer.invoke("anybot:runCommand", { id, command }).finally(() => {
      ipcRenderer.removeListener("anybot:commandOutput", outputListener);
    });
  },
  openUrl: (url) => ipcRenderer.invoke("anybot:openUrl", url),
  
  // Update-specific API with restricted methods for security
  update: {
    check: () => ipcRenderer.invoke("anybot:request", "update.check"),
    download: () => ipcRenderer.invoke("anybot:request", "update.download"),
    install: () => ipcRenderer.invoke("anybot:request", "update.install"),
    dismiss: (version) => ipcRenderer.invoke("anybot:request", "update.dismiss", { version }),
    retry: () => ipcRenderer.invoke("anybot:request", "update.retry"),
  },
});
