const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("anybot", {
  request: (method, payload) =>
    ipcRenderer.invoke("anybot:request", method, payload),
  chooseDirectory: () => ipcRenderer.invoke("anybot:directory"),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("anybot:changed", listener);
    return () => ipcRenderer.removeListener("anybot:changed", listener);
  },
});
