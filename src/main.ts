import { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, dialog, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { createPlatformAdapter, APP_MODES, APP_MODE_LABELS } from "./platform/index";
import type { PlatformAdapter, HotkeyHandlers, AppMode, HotkeyCombo, FileContext } from "./platform/index";
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
import { MAX_FILE_BYTES } from "./core/limits";

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
let currentMode: AppMode = "dictation";
// Modus zum Zeitpunkt des Hotkey-Hold-Endes — wird beim Audio-Eintreffen
// verwendet, damit ein zwischenzeitlicher Tray-/Doppeltipp-Wechsel die
// Verarbeitung nicht in den falschen Pfad schickt
let pendingMode: AppMode | null = null;
// Im Bearbeiten-Modus: Promise das beim Loslassen des Hotkeys gestartet wird
let pendingSelectedText: Promise<string> | null = null;
// Im Datei-Modus: Promise auf den Kontext (Datei, Screenshot oder Artikel)
let pendingSelectedFile: Promise<FileContext | null> | null = null;
// TTS läuft gerade
let speaking = false;

// Re-Export für die zahlreichen In-Datei-Aufrufer
const MODES = APP_MODES;
const MODE_LABELS = APP_MODE_LABELS;

// ── Artikel-Kontext (Safari → Readability) ────────────────────────────────

/** Hartes Modell-Token-Limit (Anthropic Sonnet hat ~200k, wir lassen Luft). */
const ARTICLE_TOKEN_HARD_LIMIT = 180_000;
/** Schwelle, ab der wir den Nutzer wegen Größe fragen. */
const ARTICLE_CHAR_PROMPT_THRESHOLD = 50_000;
/** Grobe Daumenregel: ~4 Zeichen pro Token. Reicht für Schwellenwert-Logik. */
const CHARS_PER_TOKEN = 4;

/**
 * Verarbeitet einen Artikel-Kontext im Datei-Modus. Zeigt bei großen Texten
 * Sicherheits-Dialoge, baut den kombinierten Prompt und ruft ai.chat() auf.
 * Gibt true zurück wenn die KI-Antwort gestartet wurde, false bei Abbruch
 * oder Konfigurationsfehler.
 */
async function handleArticleContext(
  ctx: { url: string; title: string; text: string },
  transcript: string,
  modusLabel: string,
): Promise<boolean> {
  let text = ctx.text;
  const tokens = Math.ceil(text.length / CHARS_PER_TOKEN);
  const tokensFmt = tokens.toLocaleString("de-DE");

  if (tokens > ARTICLE_TOKEN_HARD_LIMIT) {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: "JARVIS — Inhalt zu groß",
      message: "Der Artikel überschreitet das Modell-Limit",
      detail:
        `Der Artikel "${ctx.title}" hat etwa ${tokensFmt} Tokens, ` +
        `Maximum sind ${ARTICLE_TOKEN_HARD_LIMIT.toLocaleString("de-DE")}.\n\n` +
        `Wenn du fortfährst, wird nur der Anfang übergeben — der Rest wird abgeschnitten.`,
      buttons: ["Fortfahren", "Abbrechen"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) {
      console.log("JARVIS: Artikel-Verarbeitung abgebrochen (zu groß)");
      sendStatus("bereit", modusLabel);
      return false;
    }
    text = text.slice(0, ARTICLE_TOKEN_HARD_LIMIT * CHARS_PER_TOKEN);
  } else if (text.length > ARTICLE_CHAR_PROMPT_THRESHOLD) {
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "JARVIS — Längerer Artikel",
      message: "Der Artikel ist recht lang",
      detail:
        `"${ctx.title}" hat etwa ${tokensFmt} Tokens (${text.length.toLocaleString("de-DE")} Zeichen). ` +
        `Möchtest du das so an die KI schicken?`,
      buttons: ["Fortfahren", "Abbrechen"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) {
      console.log("JARVIS: Artikel-Verarbeitung abgebrochen (nach Hinweis-Dialog)");
      sendStatus("bereit", modusLabel);
      return false;
    }
  }

  const ai = getAiProvider();
  if (!ai) {
    console.error("JARVIS: Kein KI-Schlüssel für Artikel-Verarbeitung.");
    sendStatus("bereit", modusLabel);
    return false;
  }

  const prompt =
    `Hier ist der redaktionelle Hauptinhalt der Webseite "${ctx.title}" (${ctx.url}):\n\n` +
    `${text}\n\n` +
    `Frage: ${transcript}`;
  const answer = await ai.chat(prompt);
  if (answer) startSpeaking(answer);
  return true;
}

/**
 * Flacht ein Error-Objekt zu name + message + stack ab, damit beim
 * Loggen keine Header / Tokens / großen Objekte einer SDK-Fehlerantwort
 * mit ausgegeben werden.
 */
function logError(prefix: string, err: unknown): void {
  if (err instanceof Error) {
    console.error(`${prefix} ${err.name}: ${err.message}`);
    if (err.stack) console.error(err.stack);
  } else {
    console.error(`${prefix} ${String(err)}`);
  }
}

function getFeedbackPath(): string {
  return path.join(app.getPath("userData"), "feedback.md");
}

// Mutex-Kette für feedback.md — Schreibungen werden seriell ausgeführt,
// damit gleichzeitige Speicher-Klicks keine ineinandergeschachtelten
// Einträge erzeugen.
let feedbackChain: Promise<void> = Promise.resolve();

async function doSaveFeedback(t: string): Promise<void> {
  const file = getFeedbackPath();
  const ts = new Date().toLocaleString("de-DE", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  try { await fs.promises.access(file); }
  catch { await fs.promises.writeFile(file, "# JARVIS Feedback\n"); }
  await fs.promises.appendFile(file, `\n## ${ts}\n\n${t}\n`);
  console.log(`JARVIS: Feedback gespeichert in ${file}`);
  rebuildTrayMenu();
}

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
      // Sandbox aus — wir laden nur eigene HTML und müssen im Preload
      // lokale Module requiren können (z.B. ./platform/index für Mode-
      // Konstanten). Mit Sandbox-Standard scheitert require still.
      sandbox: false,
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
ipcMain.on("jarvis:settings-fit", (_, contentHeight: unknown) => {
  if (!settingsWindow) return;
  // Validieren: bei NaN/Infinity/falschem Typ vom Renderer NICHT setContentSize
  // aufrufen — sonst wird das Fenster nie sichtbar und die App wirkt tot
  if (typeof contentHeight !== "number" || !Number.isFinite(contentHeight)) {
    console.warn(`JARVIS: settings-fit mit ungültigem Wert ignoriert (${contentHeight})`);
    return;
  }
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
    {
      label: "Feedback öffnen …",
      enabled: fs.existsSync(getFeedbackPath()),
      click: () => shell.openPath(getFeedbackPath()),
    },
    { type: "separator" },
    { label: "JARVIS beenden", accelerator: "CommandOrControl+Q", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ── Provider-Cache ────────────────────────────────────────────────────────
// Anthropic-/OpenAI-Clients halten interne HTTP-Connection-Pools; wir
// instanziieren sie nur einmal pro Konfigurations-Set und invalidieren
// nach jedem Settings-Save.
interface ProviderCache {
  aiKey: string | null;
  aiProvider: AIProvider | null;
  sttKey: string | null;
  sttProvider: STTProvider | null;
}
const providerCache: ProviderCache = {
  aiKey: null, aiProvider: null, sttKey: null, sttProvider: null,
};

function invalidateProviderCache(): void {
  providerCache.aiKey = null;
  providerCache.aiProvider = null;
  providerCache.sttKey = null;
  providerCache.sttProvider = null;
}

function getAiProvider(): AIProvider | null {
  const cfg = settings.getAiConfig();
  if (!cfg) return null;
  const key = `${cfg.provider}:${cfg.apiKey}`;
  if (providerCache.aiKey !== key || !providerCache.aiProvider) {
    providerCache.aiProvider = cfg.provider === "openai"
      ? new OpenAIProvider(cfg.apiKey)
      : new AnthropicProvider(cfg.apiKey);
    providerCache.aiKey = key;
  }
  return providerCache.aiProvider;
}

/**
 * Wählt den passenden STT-Provider anhand der Einstellung. Fällt bei
 * Problemen mit "Lokal" automatisch auf Cloud zurück, wenn ein
 * Cloud-Key da ist. Gibt null zurück, wenn nichts verfügbar ist.
 */
function pickSttProvider(): STTProvider | null {
  const mode = settings.getSttMode();
  if (mode === "local") {
    const binary = findWhisperBinary();
    const model  = settings.getLocalSttModel();
    if (binary && modelExists(model)) {
      const key = `local:${binary}:${model}`;
      if (providerCache.sttKey !== key) {
        providerCache.sttProvider = new LocalWhisperProvider(binary, getModelPath(model));
        providerCache.sttKey = key;
        console.log(`JARVIS: STT lokal (Modell ${model})`);
      }
      return providerCache.sttProvider;
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
  const key = `cloud:${cfg.apiKey}:${cfg.model}`;
  if (providerCache.sttKey !== key) {
    providerCache.sttProvider = new WhisperProvider(cfg);
    providerCache.sttKey = key;
  }
  return providerCache.sttProvider;
}

function sendStatus(
  status: "bereit" | "aufnahme" | "verarbeitet" | "spricht",
  modus = "Diktat",
): void {
  pillWindow?.webContents.send("jarvis:status-update", status, modus);
}

function startSpeaking(text: string): void {
  speaking = true;
  sendStatus("spricht", MODE_LABELS[currentMode]);
  platform.registerSpeakInterrupt(stopSpeaking);

  platform.speak(text)
    .catch((err) => logError("JARVIS: TTS-Fehler:", err))
    .finally(() => { if (speaking) stopSpeaking(); });
}

function stopSpeaking(): void {
  if (!speaking) return;
  platform.stopSpeaking();
  speaking = false;
  platform.unregisterSpeakInterrupt();
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
    let settled = false;
    const listener = (_: Electron.IpcMainEvent, sources: { id: string; name: string }[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(sources);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Listener aktiv entfernen — `ipcMain.once` würde sonst beim
      // verspäteten Renderer-Reply das nächste getWindowSources-Promise
      // unkontrolliert auflösen.
      ipcMain.removeListener("jarvis:window-sources-result", listener);
      resolve([]);
    }, 3000);
    ipcMain.once("jarvis:window-sources-result", listener);
    pillWindow?.webContents.send("jarvis:get-window-sources");
  });
}

// ── Start ──────────────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  settings = new SettingsManager();
  platform = createPlatformAdapter(getWindowSources);

  await requestStartupPermissions();
  resetIpcHandlers();
  bindModeIPC();
  bindSettingsIPC();
  bindModelIPC();
  bindFeedbackIPC();
  bindRecordingFailedIPC();
  await setupHotkey();
  bindAudioIPC();
}

// ── Berechtigungen ────────────────────────────────────────────────────────

async function requestStartupPermissions(): Promise<void> {
  const perms = await platform.checkPermissions();

  if (!perms.screenRecording) {
    dialog.showMessageBox({
      type: "info",
      title: "JARVIS — Bildschirmaufnahme",
      message: "Bildschirmaufnahme-Berechtigung fehlt",
      detail:
        "Damit JARVIS Quick Look-Fenster präzise erfassen kann, bitte Electron.app in " +
        "Systemeinstellungen → Datenschutz & Sicherheit → Bildschirmaufnahme aktivieren.",
      buttons: ["Einstellungen öffnen", "Später"],
    }).then(({ response }) => {
      if (response === 0) platform.openPermissionSettings("screenRecording");
    });
  }

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
}

// ── IPC-Setup ─────────────────────────────────────────────────────────────

/** Räumt .handle-Channels, damit ein versehentlicher Re-Init nicht crasht. */
function resetIpcHandlers(): void {
  const channels = [
    "jarvis:settings-load",
    "jarvis:settings-save",
    "jarvis:stt-model-status",
    "jarvis:stt-model-download",
    "jarvis:feedback-save",
  ];
  for (const ch of channels) ipcMain.removeHandler(ch);
}

function bindModeIPC(): void {
  // Modus-Wechsel vom Renderer (Klick auf Modus-Badge)
  ipcMain.on("jarvis:set-mode", (_, mode: string) => {
    currentMode = mode as typeof currentMode;
    rebuildTrayMenu();
    console.log(`JARVIS: Modus gesetzt auf "${currentMode}"`);
  });
  // Einstellungsfenster öffnen (Klick auf Pille)
  ipcMain.on("jarvis:open-settings", () => openSettingsWindow());
}

function bindSettingsIPC(): void {
  ipcMain.handle("jarvis:settings-load", () => {
    const keys = settings.getRawKeys();
    return {
      aiProvider:   settings.getAiProvider(),
      anthropicKey: keys.anthropicApiKey,
      openaiKey:    keys.openaiApiKey,
      groqKey:      keys.groqApiKey,
      hotkey:       settings.getHotkey(),
      sttMode:      settings.getSttMode(),
      sttLocalModel: settings.getLocalSttModel(),
      whisperBinary: findWhisperBinary(),
      models: Object.fromEntries(
        (Object.keys(LOCAL_MODELS) as (keyof typeof LOCAL_MODELS)[]).map((k) => [
          k,
          { ...LOCAL_MODELS[k], present: modelExists(k) },
        ]),
      ),
    };
  });

  ipcMain.handle("jarvis:settings-save", async (_, data: Record<string, string>) => {
    const previousHotkey = settings.getHotkey();
    settings.update({
      anthropicApiKey: data.anthropicKey ?? "",
      openaiApiKey:    data.openaiKey    ?? "",
      groqApiKey:      data.groqKey      ?? "",
      aiProvider:      (data.aiProvider === "openai" ? "openai" : "anthropic"),
      hotkey:          data.hotkey as HotkeyCombo | undefined,
      sttMode:         (data.sttMode === "local" || data.sttMode === "cloud") ? data.sttMode : undefined,
      sttLocalModel:   (data.sttLocalModel as "tiny" | "base" | "small" | undefined),
    });
    invalidateProviderCache();
    console.log(`JARVIS: Einstellungen gespeichert, STT="${settings.getSttMode()}", Anbieter="${settings.getAiProvider()}", Hotkey="${settings.getHotkey()}"`);

    const newHotkey = settings.getHotkey();
    if (newHotkey !== previousHotkey && hotkeyHandlers) {
      try {
        await platform.registerHotkey(hotkeyHandlers, newHotkey);
        console.log(`JARVIS: Hotkey live neu registriert (${previousHotkey} → ${newHotkey})`);
      } catch (err) {
        logError("JARVIS: Hotkey-Reregistrierung fehlgeschlagen:", err);
      }
    }
  });

  ipcMain.on("jarvis:settings-close", () => settingsWindow?.close());
}

function bindModelIPC(): void {
  // Status eines Modells inkl. Update-Check (HEAD-Request zu HuggingFace)
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
}

function bindFeedbackIPC(): void {
  // Eintrag mit Zeitstempel an feedback.md anhängen — über feedbackChain
  // serialisiert, sonst können parallele Klicks Einträge verschachteln
  ipcMain.handle("jarvis:feedback-save", (_, text: string) => {
    const t = String(text ?? "").trim();
    if (!t) return false;
    feedbackChain = feedbackChain.then(() => doSaveFeedback(t));
    return feedbackChain.then(() => true).catch(() => false);
  });

  ipcMain.on("jarvis:feedback-open", () => {
    const file = getFeedbackPath();
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "# JARVIS Feedback\n");
      rebuildTrayMenu();
    }
    shell.openPath(file);
  });
}

function bindRecordingFailedIPC(): void {
  // Renderer meldet, dass die Aufnahme NICHT verarbeitet werden kann
  // (Mic verweigert, zu kurz, getUserMedia-Race etc.). Status zurücksetzen.
  ipcMain.on("jarvis:recording-failed", (_, reason: string) => {
    console.log(`JARVIS: Aufnahme fehlgeschlagen (${reason}) — Status zurückgesetzt`);
    pendingMode = null;
    pendingSelectedText = null;
    pendingSelectedFile = null;
    if (!speaking) sendStatus("bereit", MODE_LABELS[currentMode]);
  });
}

async function setupHotkey(): Promise<void> {
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
      // Mode "einfrieren" für die nachfolgende Audio-Verarbeitung —
      // ein Tray-Klick oder Doppeltipp dazwischen darf den Pfad nicht ändern
      pendingMode = currentMode;
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
          .then((ctx) => {
            if (!ctx) { console.log("JARVIS: Datei-Kontext = keiner"); return null; }
            if (ctx.kind === "article")
              console.log(`JARVIS: Datei-Kontext = Artikel "${ctx.title.slice(0, 60)}" (${ctx.text.length} Zeichen)`);
            else
              console.log(`JARVIS: Datei-Kontext = Datei "${ctx.path}"`);
            return ctx;
          })
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
}

function bindAudioIPC(): void {
  // Audio empfangen → transkribieren → je nach Modus verarbeiten
  ipcMain.on("jarvis:audio-data", async (_, data: ArrayBuffer, mimeType: string) => {
    // pendingMode wurde beim onHoldEnd eingefroren — damit landet die
    // Verarbeitung im richtigen Pfad, auch wenn der User zwischenzeitlich
    // den Modus gewechselt hat. Fallback auf currentMode wenn nichts da ist.
    const mode: AppMode = pendingMode ?? currentMode;
    pendingMode = null;
    const modusLabel = MODE_LABELS[mode] ?? "Diktat";
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

      console.log(`JARVIS: Modus="${mode}", selectedText.length=${selectedText.length}, transcript="${transcript}"`);

      if (mode === "conversation") {
        const ai = getAiProvider();
        if (!ai) {
          console.error("JARVIS: Kein KI-Schlüssel für Gesprächsmodus.");
          sendStatus("bereit", modusLabel);
          return;
        }
        const answer = await ai.chat(transcript);
        if (answer) startSpeaking(answer);
        return; // sendStatus wird von startSpeaking/stopSpeaking übernommen
      } else if (mode === "edit") {
        if (!selectedText) {
          console.error(
            "JARVIS: Bearbeiten-Modus aktiv, aber kein markierter Text gelesen.\n" +
            "Text vor dem Hotkey markieren und Bedienungshilfen-Berechtigung prüfen.",
          );
          sendStatus("bereit", modusLabel);
          return;
        }
        const ai = getAiProvider();
        if (!ai) {
          console.error(
            "JARVIS: Kein KI-Schlüssel für Text-bearbeiten-Modus.\n" +
            `Trage einen API-Schlüssel in ${settings.settingsFilePath} ein.`,
          );
          sendStatus("bereit", modusLabel);
          return;
        }
        const result = await ai.process(selectedText, transcript);
        if (result) await platform.insertText(result);
      } else if (mode === "file") {
        const ctx = await (pendingSelectedFile ?? Promise.resolve(null));
        pendingSelectedFile = null;
        if (!ctx) {
          console.error("JARVIS: Datei-Kontext: weder Finder-Auswahl noch Screenshot verfügbar.");
          startSpeaking("Kein Datei-Kontext gefunden. Bitte eine Datei im Finder markieren.");
          return;
        }

        if (ctx.kind === "article") {
          const done = await handleArticleContext(ctx, transcript, modusLabel);
          if (!done) return; // User hat abgebrochen
          return;
        }

        // ctx.kind === "file"
        const filePath = ctx.path;
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
          sendStatus("bereit", modusLabel);
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
      logError("JARVIS: Verarbeitungsfehler:", err);
    } finally {
      if (!speaking) sendStatus("bereit", MODE_LABELS[currentMode]);
    }
  });
}

// ── App-Lebenszyklus ───────────────────────────────────────────────────────

app.whenReady().then(() => {
  createPillWindow();
  createTray();
  initialize()
    .then(() => {
      // In Dev-Builds zeigt Electron sonst sein Default-Icon im Dock —
      // wir setzen unseres explizit. Im gepackten Build ist es schon
      // im .icns. Erst NACH initialize(), weil dort der platform-Adapter
      // erzeugt wird.
      if (!app.isPackaged) {
        platform.setAppIcon(path.join(__dirname, "../build/icon.png"));
      }
    })
    .catch((err) => logError("JARVIS: Initialisierungsfehler:", err));
  app.on("activate", () => { if (!pillWindow) createPillWindow(); });

  // Update-Check nach kurzer Verzögerung — Pille soll zuerst da sein,
  // bevor ein Dialog hochkommt
  setTimeout(() => {
    checkAndPromptUpdate().catch((err) =>
      logError("JARVIS: Update-Check-Fehler:", err),
    );
  }, 3000);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", async () => {
  platform?.unregisterSpeakInterrupt();
  await platform?.unregisterHotkey();
});
