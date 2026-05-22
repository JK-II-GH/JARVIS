import { contextBridge } from "electron";

// Sichere Bridge zwischen Main-Prozess und Renderer.
// In Phase 1 werden hier Hotkey-Ereignisse und Status-Updates durchgeleitet.
contextBridge.exposeInMainWorld("jarvis", {
  version: "0.1.0",
});
