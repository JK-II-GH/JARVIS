import { contextBridge, ipcRenderer, desktopCapturer } from "electron";

contextBridge.exposeInMainWorld("jarvis", {
  // Renderer → Main
  sendAudioData: (data: ArrayBuffer, mimeType: string) =>
    ipcRenderer.send("jarvis:audio-data", data, mimeType),
  setMode: (mode: string) =>
    ipcRenderer.send("jarvis:set-mode", mode),
  openSettings: () =>
    ipcRenderer.send("jarvis:open-settings"),

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

  // Wird aus pill.html aufgerufen um ScreenCaptureKit-Berechtigung auszulösen
  getWindowSources: () =>
    desktopCapturer
      .getSources({ types: ["window"], thumbnailSize: { width: 1, height: 1 } })
      .then((sources) => sources.map((s) => ({ id: s.id, name: s.name }))),
  sendWindowSources: (sources: { id: string; name: string }[]) =>
    ipcRenderer.send("jarvis:window-sources-result", sources),
});

// Fensterquellen für Quick Look-Erkennung — läuft im Renderer-Prozess (ScreenCaptureKit)
ipcRenderer.on("jarvis:get-window-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 1, height: 1 },
    });
    ipcRenderer.send(
      "jarvis:window-sources-result",
      sources.map((s) => ({ id: s.id, name: s.name })),
    );
  } catch {
    ipcRenderer.send("jarvis:window-sources-result", []);
  }
});
