import { contextBridge, ipcRenderer, shell } from "electron";

contextBridge.exposeInMainWorld("jarvisSettings", {
  load: () => ipcRenderer.invoke("jarvis:settings-load"),
  save: (data: Record<string, string>) => ipcRenderer.invoke("jarvis:settings-save", data),
  close: () => ipcRenderer.send("jarvis:settings-close"),
  openExternal: (url: string) => shell.openExternal(url),
  fitWindow: (contentHeight: number) =>
    ipcRenderer.send("jarvis:settings-fit", contentHeight),
});
