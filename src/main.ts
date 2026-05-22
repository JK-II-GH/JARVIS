import { app, BrowserWindow, screen, ipcMain, dialog } from "electron";
import * as path from "path";
import { createPlatformAdapter } from "./platform/index";
import type { PlatformAdapter } from "./platform/index";
import { SettingsManager } from "./core/settings";
import { WhisperProvider } from "./core/stt/WhisperProvider";

let pillWindow: BrowserWindow | null = null;
let platform: PlatformAdapter;
let settings: SettingsManager;

// ── Pille ──────────────────────────────────────────────────────────────────

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

  pillWindow.on("closed", () => {
    pillWindow = null;
  });
}

function sendStatus(status: "bereit" | "aufnahme" | "verarbeitet", modus = "Diktat"): void {
  pillWindow?.webContents.send("jarvis:status-update", status, modus);
}

// ── Start ──────────────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  settings = new SettingsManager();
  platform = createPlatformAdapter();

  // Mikrofon-Berechtigung sicherstellen
  const perms = await platform.checkPermissions();
  if (!perms.microphone) {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: "JARVIS — Mikrofon-Zugriff",
      message: "Mikrofon-Berechtigung fehlt",
      detail: "JARVIS benötigt Zugriff auf das Mikrofon, um Diktat aufzunehmen.",
      buttons: ["Einstellungen öffnen", "Abbrechen"],
    });
    if (response === 0) await platform.openPermissionSettings("microphone");
  }

  // API-Schlüssel prüfen
  if (!settings.getSttConfig()) {
    dialog.showMessageBox({
      type: "info",
      title: "JARVIS — Einrichtung",
      message: "Spracherkennungs-API-Schlüssel fehlt",
      detail:
        `Bitte trage einen Schlüssel in diese Datei ein:\n${settings.settingsFilePath}\n\n` +
        `Groq (kostenlos, empfohlen):\n{\n  "groqApiKey": "gsk_..."\n}\n\n` +
        `OpenAI (alternativ):\n{\n  "openaiApiKey": "sk-..."\n}\n\n` +
        `Groq-Schlüssel: https://console.groq.com/keys`,
      buttons: ["OK"],
    });
  }

  // Hotkey registrieren: Cmd+Alt halten = aufnehmen
  await platform.registerHotkey({
    onHoldStart: () => {
      sendStatus("aufnahme");
      pillWindow?.webContents.send("jarvis:start-recording");
    },
    onHoldEnd: () => {
      sendStatus("verarbeitet");
      pillWindow?.webContents.send("jarvis:stop-recording");
    },
    onDoubleTap: () => {
      // Phase 3: Modus wechseln
    },
  });

  // Audio-Daten vom Renderer empfangen und transkribieren
  ipcMain.on("jarvis:audio-data", async (_, data: ArrayBuffer, mimeType: string) => {
    try {
      const sttConfig = settings.getSttConfig();
      if (!sttConfig) {
        console.error("JARVIS: Kein STT-API-Schlüssel konfiguriert.");
        sendStatus("bereit");
        return;
      }

      const whisper = new WhisperProvider(sttConfig);
      const transcript = await whisper.transcribe(Buffer.from(data), mimeType);

      console.log(`JARVIS: Transkript = "${transcript}" (${transcript.length} Zeichen)`);
      if (transcript) {
        await platform.insertText(transcript);
      }
    } catch (err) {
      console.error("JARVIS: Transkriptionsfehler:", err);
    } finally {
      sendStatus("bereit");
    }
  });
}

// ── App-Lebenszyklus ───────────────────────────────────────────────────────

app.whenReady().then(() => {
  createPillWindow();
  initialize().catch((err) => console.error("JARVIS: Initialisierungsfehler:", err));

  app.on("activate", () => {
    if (!pillWindow) createPillWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", async () => {
  await platform?.unregisterHotkey();
});
