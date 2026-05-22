import { app, BrowserWindow, screen, ipcMain, dialog, globalShortcut } from "electron";
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
let currentMode: "dictation" | "edit" | "conversation" = "dictation";
// Im Bearbeiten-Modus: Promise das beim Loslassen des Hotkeys gestartet wird
let pendingSelectedText: Promise<string> | null = null;
// TTS läuft gerade
let speaking = false;

const MODES: Array<"dictation" | "edit" | "conversation"> = ["dictation", "edit", "conversation"];
const MODE_LABELS: Record<string, string> = {
  dictation: "Diktat", edit: "Bearbeiten", conversation: "Gespräch",
};

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

function sendStatus(status: "bereit" | "aufnahme" | "verarbeitet" | "spricht", modus = "Diktat"): void {
  pillWindow?.webContents.send("jarvis:status-update", status, modus);
}

function startSpeaking(text: string): void {
  speaking = true;
  sendStatus("spricht", MODE_LABELS[currentMode]);
  globalShortcut.register("Escape", stopSpeaking);
  platform.speak(text).then(() => {
    if (speaking) stopSpeaking();
  });
}

function stopSpeaking(): void {
  if (!speaking) return;
  platform.stopSpeaking();
  speaking = false;
  globalShortcut.unregister("Escape");
  sendStatus("bereit", MODE_LABELS[currentMode]);
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

  // Modus-Wechsel vom Renderer (Klick auf Modus-Badge)
  ipcMain.on("jarvis:set-mode", (_, mode: string) => {
    currentMode = mode as "dictation" | "edit";
    console.log(`JARVIS: Modus gesetzt auf "${currentMode}"`);
  });

  // Hotkey: Cmd+Alt halten
  await platform.registerHotkey({
    onHoldStart: () => {
      // Laufende TTS beim neuen Hotkey-Druck stoppen
      if (speaking) stopSpeaking();
      pendingSelectedText = null;
      sendStatus("aufnahme", MODE_LABELS[currentMode]);
      pillWindow?.webContents.send("jarvis:start-recording");
    },
    onHoldEnd: () => {
      sendStatus("verarbeitet", MODE_LABELS[currentMode]);
      pillWindow?.webContents.send("jarvis:stop-recording");
      if (currentMode === "edit") {
        // Text lesen nachdem Cmd+Alt losgelassen wurden → kein Modifier-Konflikt
        pendingSelectedText = platform.readSelectedText()
          .then((text) => {
            console.log(`JARVIS: markierter Text = "${text.slice(0, 60)}..." (${text.length} Zeichen)`);
            return text;
          })
          .catch(() => "");
      }
    },
    onDoubleTap: () => {
      const idx = MODES.indexOf(currentMode);
      currentMode = MODES[(idx + 1) % MODES.length];
      pillWindow?.webContents.send("jarvis:mode-update", currentMode);
      console.log(`JARVIS: Modus (Doppeltipp) → "${currentMode}"`);
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

      // Transkription und Text-Lesen parallel — STT dauert ~1-2 s, mehr als genug Zeit
      const [transcript, selectedText] = await Promise.all([
        new WhisperProvider(sttConfig).transcribe(Buffer.from(data), mimeType),
        pendingSelectedText ?? Promise.resolve(""),
      ]);
      pendingSelectedText = null;

      if (!transcript) {
        sendStatus("bereit", modusLabel);
        return;
      }

      console.log(`JARVIS: Modus="${currentMode}", selectedText.length=${selectedText.length}, transcript="${transcript}"`);

      if (currentMode === "conversation") {
        // Gesprächsmodus: KI antworten lassen und vorlesen
        const aiConfig = settings.getAiConfig();
        if (!aiConfig) {
          console.error("JARVIS: Kein KI-Schlüssel für Gesprächsmodus.");
          sendStatus("bereit", "Gespräch");
          return;
        }
        const answer = await new AnthropicProvider(aiConfig.apiKey).chat(transcript);
        if (answer) startSpeaking(answer);
        return; // sendStatus wird von startSpeaking/stopSpeaking übernommen
      } else if (currentMode === "edit") {
        if (!selectedText) {
          console.error(
            "JARVIS: Bearbeiten-Modus aktiv, aber kein markierter Text gelesen.\n" +
            "Text vor dem Hotkey markieren und Bedienungshilfen-Berechtigung prüfen.",
          );
          sendStatus("bereit", "Bearbeiten");
          return;
        }
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
          .process(selectedText, transcript);
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
  globalShortcut.unregisterAll();
  await platform?.unregisterHotkey();
});
