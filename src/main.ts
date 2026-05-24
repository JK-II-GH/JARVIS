import { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, dialog, globalShortcut, systemPreferences, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { createPlatformAdapter } from "./platform/index";
import type { PlatformAdapter, HotkeyHandlers } from "./platform/index";
import { SettingsManager } from "./core/settings";
import { WhisperProvider } from "./core/stt/WhisperProvider";
import { LocalWhisperProvider } from "./core/stt/LocalWhisperProvider";
import {
  MODELS as LOCAL_MODELS,
  findWhisperBinary,
  modelExists,
  getModelPath,
  downloadModel,
  checkModelStatus,
} from "./core/stt/localWhisper";
import type { STTProvider } from "./core/stt/STTProvider";
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
let hotkeyHandlers: HotkeyHandlers | null = null;

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
    width: 360,
    height: 48,
    x: Math.round(width / 2) - 180,
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
    height: 200,          // Platzhalter — wird per fitWindow vom Renderer angepasst
    useContentSize: true, // Höhe meint die Inhaltsfläche, nicht inkl. Titlebar
    show: false,          // Erst anzeigen, wenn die Größe stimmt — kein Flicker
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

// Renderer meldet die gewünschte Inhaltshöhe — Fenster wird passend
// gesetzt und sichtbar gemacht. Damit wächst es bei neuen Settings-
// Sektionen automatisch mit, ohne dass wir die Höhe hier pflegen müssen.
ipcMain.on("jarvis:settings-fit", (_, contentHeight: number) => {
  if (!settingsWindow) return;
  const [w] = settingsWindow.getContentSize();
  const clamped = Math.min(900, Math.max(200, Math.round(contentHeight)));
  settingsWindow.setContentSize(w, clamped);
  if (!settingsWindow.isVisible()) settingsWindow.show();
});

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

/**
 * Wählt den passenden STT-Provider anhand der Einstellung. Fällt bei
 * Problemen mit "Lokal" automatisch auf Cloud zurück, wenn ein
 * Cloud-Key da ist. Gibt null zurück, wenn nichts verfügbar ist.
 */
function pickSttProvider(): STTProvider | null {
  if (settings.getSttMode() === "local") {
    const binary = findWhisperBinary();
    const model  = settings.getLocalSttModel();
    if (binary && modelExists(model)) {
      console.log(`JARVIS: STT lokal (Modell ${model})`);
      return new LocalWhisperProvider(binary, getModelPath(model));
    }
    console.warn(
      `JARVIS: Lokale STT nicht einsatzbereit (Binary: ${binary ? "ok" : "fehlt"}, ` +
      `Modell ${model}: ${modelExists(model) ? "ok" : "fehlt"}) → Cloud-Fallback`,
    );
  }
  const cfg = settings.getSttConfig();
  if (!cfg) {
    console.error("JARVIS: Kein STT-Provider verfügbar (weder lokal noch Cloud).");
    return null;
  }
  return new WhisperProvider(cfg);
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
    const localModel = settings.getLocalSttModel();
    return {
      aiProvider:   settings.getAiProvider(),
      anthropicKey: keys.anthropicApiKey,
      openaiKey:    keys.openaiApiKey,
      groqKey:      keys.groqApiKey,
      hotkey:       settings.getHotkey(),
      sttMode:      settings.getSttMode(),
      sttLocalModel: localModel,
      whisperBinary: findWhisperBinary(),
      models: Object.fromEntries(
        (Object.keys(LOCAL_MODELS) as (keyof typeof LOCAL_MODELS)[]).map((k) => [
          k,
          { ...LOCAL_MODELS[k], present: modelExists(k) },
        ]),
      ),
    };
  });

  // Status eines einzelnen Modells inkl. Update-Check (HEAD-Request zu HF)
  ipcMain.handle("jarvis:stt-model-status", async (_, model) => {
    return await checkModelStatus(model);
  });

  // Download eines Modells anstoßen — Fortschritt geht per Event zurück
  ipcMain.handle("jarvis:stt-model-download", async (event, model) => {
    try {
      await downloadModel(model, (received, total) => {
        event.sender.send("jarvis:stt-model-progress", { model, received, total });
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) };
    }
  });

  ipcMain.handle("jarvis:settings-save", async (_, data: Record<string, string>) => {
    const previousHotkey = settings.getHotkey();
    const raw = JSON.parse(fs.readFileSync(settings.settingsFilePath, "utf-8") || "{}");
    if (data.anthropicKey) raw.anthropicApiKey = data.anthropicKey; else delete raw.anthropicApiKey;
    if (data.openaiKey)    raw.openaiApiKey    = data.openaiKey;    else delete raw.openaiApiKey;
    if (data.groqKey)      raw.groqApiKey      = data.groqKey;      else delete raw.groqApiKey;
    raw.aiProvider = data.aiProvider || "anthropic";
    if (data.hotkey) raw.hotkey = data.hotkey;
    if (data.sttMode === "local" || data.sttMode === "cloud") raw.sttMode = data.sttMode;
    if (data.sttLocalModel) raw.sttLocalModel = data.sttLocalModel;
    fs.writeFileSync(settings.settingsFilePath, JSON.stringify(raw, null, 2));
    settings = new SettingsManager();
    console.log(`JARVIS: Einstellungen gespeichert, STT="${raw.sttMode ?? "cloud"}", Anbieter="${raw.aiProvider}", Hotkey="${raw.hotkey ?? "default"}"`);

    // Hotkey live neu registrieren, falls sich die Kombi geändert hat
    const newHotkey = settings.getHotkey();
    if (newHotkey !== previousHotkey && hotkeyHandlers) {
      try {
        await platform.registerHotkey(hotkeyHandlers, newHotkey);
        console.log(`JARVIS: Hotkey live neu registriert (${previousHotkey} → ${newHotkey})`);
      } catch (err) {
        console.error("JARVIS: Hotkey-Reregistrierung fehlgeschlagen:", err);
      }
    }
  });

  ipcMain.on("jarvis:settings-close", () => settingsWindow?.close());

  // Hotkey-Handler einmalig zusammenstellen — werden beim Re-Register
  // mit anderem Combo unverändert wiederverwendet
  hotkeyHandlers = {
    onPrepareStart: () => {
      // Sofort beim Drücken beider Modifier: Mikrofon-Setup im Renderer
      // anstoßen, damit beim Hold-Confirm bereits Audio fließt. Laufende
      // TTS hier schon stoppen, weil sie ohnehin obsolet ist.
      if (speaking) stopSpeaking();
      pendingSelectedText = null;
      pillWindow?.webContents.send("jarvis:start-recording");
    },
    onPrepareCancel: () => {
      // Tap — vorbereitete Aufnahme verwerfen, KEINE Verarbeitung
      pillWindow?.webContents.send("jarvis:cancel-recording");
    },
    onHoldStart: () => {
      // Hold bestätigt: jetzt zeigt die Pille "Aufnahme"
      sendStatus("aufnahme", MODE_LABELS[currentMode]);
    },
    onHoldEnd: () => {
      sendStatus("verarbeitet", MODE_LABELS[currentMode]);
      pillWindow?.webContents.send("jarvis:stop-recording");
      if (currentMode === "edit") {
        // Text lesen nachdem Modifier losgelassen wurden — kein Konflikt
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
  };

  await platform.registerHotkey(hotkeyHandlers, settings.getHotkey());
  console.log(`JARVIS: Hotkey registriert (${settings.getHotkey()})`);

  // Audio empfangen → transkribieren → je nach Modus verarbeiten
  ipcMain.on("jarvis:audio-data", async (_, data: ArrayBuffer, mimeType: string) => {
    const modusLabel = currentMode === "edit" ? "Bearbeiten" : "Diktat";
    try {
      const stt = pickSttProvider();
      if (!stt) {
        sendStatus("bereit", modusLabel);
        return;
      }

      // Transkription und Text-Lesen parallel — Cloud-STT dauert ~1-2 s,
      // mehr als genug Zeit. Lokal dauert etwas länger; läuft aber genauso async.
      const [transcript, selectedText] = await Promise.all([
        stt.transcribe(Buffer.from(data), mimeType),
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
  // In Dev-Builds zeigt Electron sonst sein Default-Icon im Dock —
  // wir setzen unseres explizit. Im gepackten Build ist es schon im .icns.
  if (!app.isPackaged && process.platform === "darwin") {
    const devIcon = path.join(__dirname, "../build/icon.png");
    if (fs.existsSync(devIcon)) app.dock?.setIcon(devIcon);
  }

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
