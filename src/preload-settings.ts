import { contextBridge, ipcRenderer, shell } from "electron";

contextBridge.exposeInMainWorld("jarvisSettings", {
  load: () => ipcRenderer.invoke("jarvis:settings-load"),
  save: (data: Record<string, string>) => ipcRenderer.invoke("jarvis:settings-save", data),
  close: () => ipcRenderer.send("jarvis:settings-close"),
  openExternal: (url: string) => shell.openExternal(url),
  fitWindow: (contentHeight: number) =>
    ipcRenderer.send("jarvis:settings-fit", contentHeight),

  // Lokale STT
  modelStatus: (model: string) =>
    ipcRenderer.invoke("jarvis:stt-model-status", model),
  downloadModel: (model: string) =>
    ipcRenderer.invoke("jarvis:stt-model-download", model),
  onModelProgress: (cb: (data: { model: string; received: number; total: number }) => void) =>
    ipcRenderer.on("jarvis:stt-model-progress", (_, data) => cb(data)),

  // Feedback
  feedbackSave: (text: string) => ipcRenderer.invoke("jarvis:feedback-save", text),
  feedbackOpen: () => ipcRenderer.send("jarvis:feedback-open"),
});
