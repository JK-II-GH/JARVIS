import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("jarvis", {
  // Renderer → Main
  sendAudioData: (data: ArrayBuffer, mimeType: string) =>
    ipcRenderer.send("jarvis:audio-data", data, mimeType),
  setMode: (mode: string) =>
    ipcRenderer.send("jarvis:set-mode", mode),

  // Main → Renderer
  onStartRecording: (cb: () => void) =>
    ipcRenderer.on("jarvis:start-recording", () => cb()),
  onStopRecording: (cb: () => void) =>
    ipcRenderer.on("jarvis:stop-recording", () => cb()),
  onStatusUpdate: (cb: (status: string, modus: string) => void) =>
    ipcRenderer.on("jarvis:status-update", (_, status: string, modus: string) =>
      cb(status, modus),
    ),
  onModeUpdate: (cb: (mode: string) => void) =>
    ipcRenderer.on("jarvis:mode-update", (_, mode: string) => cb(mode)),
});
