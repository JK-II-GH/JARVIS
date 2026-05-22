import { app, BrowserWindow, screen, ipcMain, dialog } from "electron";
import * as path from "path";
import { createPlatformAdapter } from "./platform/index";
import type { PlatformAdapter } from "./platform/index";
import { SettingsManager } from "./core/settings";
import { WhisperProvider } from "./core/stt/WhisperProvider";
import { AnthropicProvider } from "./core/ai/AnthropicProvider";

let pillWindow: BrowserWindow | null = null;
let platform: PlatformAdapter;
let settings: SettingsManager;

// Zustand des aktuellen Vorgangs
let currentMode: "dictation" | "edit" = "dictation";
let currentSelectedText = "";

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
  pillWindow.on("closed", () => { pillWindow = null; });
}

function sendStatus(status: "bereit" | "aufnahme" | "verarbeitet", modus = "Diktat"): void {
  pillWindow?.webContents.send("jarvis:status-update", status, modus);
}

// ── Start ──────────────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  settings = new SettingsManager();
  platform = createPlatformAdapter();

  const perms = await platform.checkPermissions();

  // Mikrofon-Berechtigung
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

  // Bedienungshilfen-Berechtigung (für Text lesen/ersetzen in Phase 2)
  if (!perms.accessibility) {
    dialog.showMessageBox({
      type: "info",
      title: "JARVIS — Bedienungshilfen",
      message: "Bedienungshilfen-Berechtigung fehlt",
      detail:
        "Fuer den Modus 'Text bearbeiten' braucht JARVIS Zugriff auf Bedienungshilfen.\n" +
        "Diktat funktioniert trotzdem bereits.\n\n" +
        "Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen → " +
        "Electron.app aktivieren.",
      buttons: ["Einstellungen öffnen", "Später"],
    }).then(({ response }) => {
      if (response === 0) platform.openPermissionSettings("accessibility");
    });
  }

  // STT-Schlüssel prüfen
  if (!settings.getSttConfig()) {
    dialog.showMessageBox({
      type: "info",
      title: "JARVIS — Einrichtung",
      message: "Spracherkennungs-API-Schlüssel fehlt",
      detail:
        `Bitte trage einen Schlüssel in:\n${settings.settingsFilePath}\n\n` +
        `Groq (kostenlos):\n{\n  "groqApiKey": "gsk_..."\n}\n\n` +
        `Groq-Schlüssel: https://console.groq.com/keys`,
      buttons: ["OK"],
    });
  }

  // Hotkey: Cmd+Alt halten
  await platform.registerHotkey({
    onHoldStart: () => {
      // Markierten Text lesen und Modus bestimmen (bevor Aufnahme startet)
      (async () => {
        currentSelectedText = await platform.readSelectedText();
        currentMode = currentSelectedText ? "edit" : "dictation";
        const modusLabel = currentMode === "edit" ? "Bearbeiten" : "Diktat";
        sendStatus("aufnahme", modusLabel);
        pillWindow?.webContents.send("jarvis:start-recording");
      })().catch((err) => {
        console.error("JARVIS: Modus-Erkennung fehlgeschlagen:", err);
        currentMode = "dictation";
        currentSelectedText = "";
        sendStatus("aufnahme", "Diktat");
        pillWindow?.webContents.send("jarvis:start-recording");
      });
    },
    onHoldEnd: () => {
      const modusLabel = currentMode === "edit" ? "Bearbeiten" : "Diktat";
      sendStatus("verarbeitet", modusLabel);
      pillWindow?.webContents.send("jarvis:stop-recording");
    },
    onDoubleTap: () => {
      // Phase 3: Modus manuell wechseln
    },
  });

  // Audio empfangen → transkribieren → je nach Modus verarbeiten
  ipcMain.on("jarvis:audio-data", async (_, data: ArrayBuffer, mimeType: string) => {
    const modusLabel = currentMode === "edit" ? "Bearbeiten" : "Diktat";
    try {
      const sttConfig = settings.getSttConfig();
      if (!sttConfig) {
        console.error("JARVIS: Kein STT-Schlüssel konfiguriert.");
        sendStatus("bereit", modusLabel);
        return;
      }

      const transcript = await new WhisperProvider(sttConfig)
        .transcribe(Buffer.from(data), mimeType);

      if (!transcript) {
        sendStatus("bereit", modusLabel);
        return;
      }

      if (currentMode === "edit" && currentSelectedText) {
        // Text-bearbeiten-Modus: Sprachbefehl per KI auf markierten Text anwenden
        const aiConfig = settings.getAiConfig();
        if (!aiConfig) {
          console.error(
            "JARVIS: Kein KI-Schlüssel für Text-bearbeiten-Modus.\n" +
            `Trage "anthropicApiKey" in ${settings.settingsFilePath} ein.`,
          );
          sendStatus("bereit", "Bearbeiten");
          return;
        }
        const result = await new AnthropicProvider(aiConfig.apiKey)
          .process(currentSelectedText, transcript);
        if (result) await platform.insertText(result);
      } else {
        // Diktat-Modus: Transkript einfügen
        await platform.insertText(transcript);
      }
    } catch (err) {
      console.error("JARVIS: Verarbeitungsfehler:", err);
    } finally {
      sendStatus("bereit", currentMode === "edit" ? "Bearbeiten" : "Diktat");
    }
  });
}

// ── App-Lebenszyklus ───────────────────────────────────────────────────────

app.whenReady().then(() => {
  createPillWindow();
  initialize().catch((err) => console.error("JARVIS: Initialisierungsfehler:", err));
  app.on("activate", () => { if (!pillWindow) createPillWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", async () => {
  await platform?.unregisterHotkey();
});
