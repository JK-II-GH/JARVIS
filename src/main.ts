import { app, BrowserWindow, screen } from "electron";
import * as path from "path";

let pillWindow: BrowserWindow | null = null;

function createPillWindow(): void {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  pillWindow = new BrowserWindow({
    width: 200,
    height: 48,
    x: Math.round(width / 2) - 100,
    y: 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  pillWindow.loadFile(path.join(__dirname, "../src/renderer/pill.html"));

  // Verhindert, dass ein Klick auf die Pille den Fokus stiehlt
  pillWindow.setIgnoreMouseEvents(false);

  pillWindow.on("closed", () => {
    pillWindow = null;
  });
}

app.whenReady().then(() => {
  createPillWindow();

  app.on("activate", () => {
    if (pillWindow === null) {
      createPillWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
