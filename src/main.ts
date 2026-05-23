import { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, dialog, globalShortcut, systemPreferences, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { createPlatformAdapter } from "./platform/index";
import type { PlatformAdapter } from "./platform/index";
import { SettingsManager } from "./core/settings";
import { WhisperProvider } from "./core/stt/WhisperProvider";
import { AnthropicProvider } from "./core/ai/AnthropicProvider";
import { OpenAIProvider } from "./core/ai/OpenAIProvider";
import type { AIProvider } from "./core/ai/AIProvider";
import { checkForUpdate } from "./core/UpdateChecker";

// GitHub-Repo für Release-Prüfung (siehe Update-Check beim Start).
const UPDATE_OWNER = "JK-II-GH";
const UPDATE_REPO  = "JARVIS";

let pillWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let platform: PlatformAdapter;
let settings: SettingsManager;

// Zustand des aktuellen Vorgangs
let currentMode: "dictation" | "edit" | "conversation" | "file" = "dictation";
// Im Bearbeiten-Modus: Promise das beim Loslassen des Hotkeys gestartet wird
let pendingSelectedText: Promise<string> | null = null;
// Im Datei-Modus: Promise auf den Dateipfad (Finder-Auswahl oder Screenshot)
let pendingSelectedFile: Promise<string | null> | null = null;
// TTS läuft gerade
let speaking = false;

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

const MODES: Array<"dictation" | "edit" | "conversation" | "file"> = ["dictation", "edit", "conversation", "file"];
const MODE_LABELS: Record<string, string> = {
  dictation: "Diktat", edit: "Bearbeiten", conversation: "Gespräch", file: "Datei",
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

function openSettingsWindow(): void {
  if (settingsWindow) { settingsWindow.focus(); return; }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 380,
    title: "JARVIS — Einstellungen",
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-settings.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, "../src/renderer/settings.html"));
  settingsWindow.on("closed", () => { settingsWindow = null; });
}

// ── Tray-Icon (Menüleiste) ────────────────────────────────────────────────

function createTray(): void {
  const iconPath = path.join(__dirname, "../src/renderer/trayIconTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  // Template-Image: macOS färbt automatisch passend zum Menüleisten-Theme
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip("JARVIS");
  rebuildTrayMenu();
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const modeLabel = MODE_LABELS[currentMode] ?? currentMode;

  const menu = Menu.buildFromTemplate([
    { label: `Modus: ${modeLabel}`, enabled: false },
    { type: "separator" },
    ...MODES.map((m) => ({
      label: MODE_LABELS[m],
      type: "radio" as const,
      checked: m === currentMode,
      click: () => {
        currentMode = m;
        pillWindow?.webContents.send("jarvis:mode-update", m);
        rebuildTrayMenu();
      },
    })),
    { type: "separator" },
    { label: "Einstellungen …", click: () => openSettingsWindow() },
    { type: "separator" },
    { label: "JARVIS beenden", accelerator: "CommandOrControl+Q", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function getAiProvider(): AIProvider | null {
  const cfg = settings.getAiConfig();
  if (!cfg) return null;
  return cfg.provider === "openai"
    ? new OpenAIProvider(cfg.apiKey)
    : new AnthropicProvider(cfg.apiKey);
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

// ── Update-Check beim Start ────────────────────────────────────────────────

async function checkAndPromptUpdate(): Promise<void> {
  // Dev-Modus überspringen — `electron .` hat keine sinnvolle App-Version
  if (!app.isPackaged) {
    console.log("JARVIS: Update-Check übersprungen (Dev-Modus)");
    return;
  }
  const update = await checkForUpdate(UPDATE_OWNER, UPDATE_REPO, app.getVersion());
  if (!update) return;

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "JARVIS — Update verfügbar",
    message: `Version ${update.version} ist verfügbar`,
    detail: `Du nutzt aktuell ${app.getVersion()}.\n\n${update.notes.slice(0, 400)}`,
    buttons: ["Download öffnen", "Später"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) shell.openExternal(update.htmlUrl);
}

// ── Fensterquellen aus Renderer-Prozess holen (ScreenCaptureKit) ───────────

function getWindowSources(): Promise<{ id: string; name: string }[]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 3000);
    ipcMain.once("jarvis:window-sources-result", (_, sources) => {
      clearTimeout(timer);
      resolve(sources);
    });
    pillWindow?.webContents.send("jarvis:get-window-sources");
  });
}

// ── Start ──────────────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  settings = new SettingsManager();
  platform = createPlatformAdapter(getWindowSources);

  // Screen-Recording-Status prüfen — nötig für Quick Look-Fenstererkennung
  const screenStatus = systemPreferences.getMediaAccessStatus("screen");
  console.log(`JARVIS: Screen Recording Status = "${screenStatus}"`);
  if (screenStatus !== "granted") {
    dialog.showMessageBox({
      type: "info",
      title: "JARVIS — Bildschirmaufnahme",
      message: "Bildschirmaufnahme-Berechtigung fehlt",
      detail:
        "Damit JARVIS Quick Look-Fenster präzise erfassen kann, bitte Electron.app in " +
        "Systemeinstellungen → Datenschutz & Sicherheit → Bildschirmaufnahme aktivieren.",
      buttons: ["Einstellungen öffnen", "Später"],
    }).then(({ response }) => {
      if (response === 0)
        shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        );
    });
  }

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
    currentMode = mode as typeof currentMode;
    rebuildTrayMenu();
    console.log(`JARVIS: Modus gesetzt auf "${currentMode}"`);
  });

  // Einstellungsfenster öffnen (Klick auf Pille)
  ipcMain.on("jarvis:open-settings", () => openSettingsWindow());

  // Settings laden / speichern
  ipcMain.handle("jarvis:settings-load", () => {
    const keys = settings.getRawKeys();
    return {
      aiProvider:   settings.getAiProvider(),
      anthropicKey: keys.anthropicApiKey,
      openaiKey:    keys.openaiApiKey,
      groqKey:      keys.groqApiKey,
    };
  });

  ipcMain.handle("jarvis:settings-save", (_, data: Record<string, string>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    const raw = JSON.parse(fs.readFileSync(settings.settingsFilePath, "utf-8") || "{}");
    if (data.anthropicKey) raw.anthropicApiKey = data.anthropicKey; else delete raw.anthropicApiKey;
    if (data.openaiKey)    raw.openaiApiKey    = data.openaiKey;    else delete raw.openaiApiKey;
    if (data.groqKey)      raw.groqApiKey      = data.groqKey;      else delete raw.groqApiKey;
    raw.aiProvider = data.aiProvider || "anthropic";
    fs.writeFileSync(settings.settingsFilePath, JSON.stringify(raw, null, 2));
    settings = new SettingsManager();
    console.log(`JARVIS: Einstellungen gespeichert, Anbieter="${raw.aiProvider}"`);
  });

  ipcMain.on("jarvis:settings-close", () => settingsWindow?.close());

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
      } else if (currentMode === "file") {
        pendingSelectedFile = platform.resolveFileContext()
          .then((p) => { console.log(`JARVIS: Datei-Kontext = "${p ?? "keiner"}"`); return p; })
          .catch(() => null);
      }
    },
    onDoubleTap: () => {
      const idx = MODES.indexOf(currentMode);
      currentMode = MODES[(idx + 1) % MODES.length];
      pillWindow?.webContents.send("jarvis:mode-update", currentMode);
      rebuildTrayMenu();
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
        const ai = getAiProvider();
        if (!ai) {
          console.error("JARVIS: Kein KI-Schlüssel für Gesprächsmodus.");
          sendStatus("bereit", "Gespräch");
          return;
        }
        const answer = await ai.chat(transcript);
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
        const ai = getAiProvider();
        if (!ai) {
          console.error(
            "JARVIS: Kein KI-Schlüssel für Text-bearbeiten-Modus.\n" +
            `Trage einen API-Schlüssel in ${settings.settingsFilePath} ein.`,
          );
          sendStatus("bereit", "Bearbeiten");
          return;
        }
        const result = await ai.process(selectedText, transcript);
        if (result) await platform.insertText(result);
      } else if (currentMode === "file") {
        const filePath = await (pendingSelectedFile ?? Promise.resolve(null));
        pendingSelectedFile = null;
        if (!filePath) {
          console.error("JARVIS: Datei-Kontext: weder Finder-Auswahl noch Screenshot verfügbar.");
          startSpeaking("Kein Datei-Kontext gefunden. Bitte eine Datei im Finder markieren.");
          return;
        }
        const fileSize = fs.statSync(filePath).size;
        if (fileSize > MAX_FILE_BYTES) {
          const mb = (fileSize / 1024 / 1024).toFixed(0);
          console.error(`JARVIS: Datei zu groß: ${mb} MB (max. 20 MB)`);
          startSpeaking(`Die Datei ist ${mb} Megabyte groß und damit zu groß. Das Maximum liegt bei zwanzig Megabyte.`);
          return;
        }
        const ai = getAiProvider();
        if (!ai) {
          console.error("JARVIS: Kein KI-Schlüssel für Datei-Kontext-Modus.");
          sendStatus("bereit", "Datei");
          return;
        }
        const answer = await ai.chatWithFile(filePath, transcript);
        if (answer) startSpeaking(answer);
        return;
      } else {
        // Diktat-Modus: Transkript einfügen
        await platform.insertText(transcript);
      }
    } catch (err) {
      console.error("JARVIS: Verarbeitungsfehler:", err);
    } finally {
      if (!speaking) sendStatus("bereit", MODE_LABELS[currentMode]);
    }
  });
}

// ── App-Lebenszyklus ───────────────────────────────────────────────────────

app.whenReady().then(() => {
  createPillWindow();
  createTray();
  initialize().catch((err) => console.error("JARVIS: Initialisierungsfehler:", err));
  app.on("activate", () => { if (!pillWindow) createPillWindow(); });

  // Update-Check nach kurzer Verzögerung — Pille soll zuerst da sein,
  // bevor ein Dialog hochkommt
  setTimeout(() => {
    checkAndPromptUpdate().catch((err) =>
      console.error("JARVIS: Update-Check-Fehler:", err),
    );
  }, 3000);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", async () => {
  globalShortcut.unregisterAll();
  await platform?.unregisterHotkey();
});
