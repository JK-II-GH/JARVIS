import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("jarvisSettings", {
  load: () => ipcRenderer.invoke("jarvis:settings-load"),
  save: (data: Record<string, string>) => ipcRenderer.invoke("jarvis:settings-save", data),
  close: () => ipcRenderer.send("jarvis:settings-close"),
});
