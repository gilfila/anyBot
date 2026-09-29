const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Allowed update methods - restrict to safe operations only
const ALLOWED_UPDATE_METHODS = new Set([
  "update.check",
  "update.download",
  "update.install",
  "update.cancelInstall",
  "update.dismiss",
  "update.retry",
]);

contextBridge.exposeInMainWorld("anybot", {
  request: (method, payload) =>
    ipcRenderer.invoke("anybot:request", method, payload),
  chooseDirectory: () => ipcRenderer.invoke("anybot:directory"),
  // Chat attachments: the sandboxed renderer can't read File.path, so a
  // dropped file's path comes from webUtils; the picker is a native dialog
  // ("files" or "folders", since Windows can't mix them in one dialog).
  getPathForFile: (file) => webUtils.getPathForFile(file),
  chooseAttachments: (kind) => ipcRenderer.invoke("anybot:attachments", kind),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("anybot:changed", listener);
    return () => ipcRenderer.removeListener("anybot:changed", listener);
  },
  // A clicked notification: ids of the conversation, run or approval to open.
  onNavigate: (callback) => {
    const listener = (_event, target) => callback(target);
    ipcRenderer.on("anybot:navigate", listener);
    return () => ipcRenderer.removeListener("anybot:navigate", listener);
  },
  listDirectory: (path) => ipcRenderer.invoke("anybot:listDirectory", path),
  revealPath: (path) => ipcRenderer.invoke("anybot:revealPath", path),
  // The context rail's Terminal. `cwd` is the folder to run in (main falls
  // back to the owner's home); `id` lets stopCommand end it.
  runCommand: (command, onOutput, { cwd, id } = {}) => {
    const key = typeof id === "string" && id ? id.slice(0, 64) : Math.random().toString(36).slice(2);
    const outputListener = (_event, data) => {
      if (data.id === key && data.chunk) {
        onOutput?.(data.chunk);
      }
    };
    ipcRenderer.on("anybot:commandOutput", outputListener);
    return ipcRenderer.invoke("anybot:runCommand", { id: key, command, cwd: typeof cwd === "string" ? cwd : "" }).finally(() => {
      ipcRenderer.removeListener("anybot:commandOutput", outputListener);
    });
  },
  stopCommand: (id) => ipcRenderer.invoke("anybot:stopCommand", String(id || "")),
  openUrl: (url) => ipcRenderer.invoke("anybot:openUrl", url),
  
  // Update-specific API with restricted methods for security
  update: {
    check: () => ipcRenderer.invoke("anybot:request", "update.check"),
    download: () => ipcRenderer.invoke("anybot:request", "update.download"),
    // { when: "idle" } installs once no bot is working.
    install: (options) => ipcRenderer.invoke("anybot:request", "update.install", options?.when === "idle" ? { when: "idle" } : {}),
    cancelInstall: () => ipcRenderer.invoke("anybot:request", "update.cancelInstall"),
    dismiss: (version) => ipcRenderer.invoke("anybot:request", "update.dismiss", { version }),
    retry: () => ipcRenderer.invoke("anybot:request", "update.retry"),
  },
});
