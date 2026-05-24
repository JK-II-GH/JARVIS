/**
 * JARVIS — Platform-Adapter-Schnittstelle
 *
 * Dies ist der architektonische Schluessel des Projekts: ALLES, was sich
 * zwischen macOS und Windows unterscheidet, laeuft ueber diese Schnittstelle.
 *
 * Kernlogik (src/core) und Oberflaeche (src/renderer) duerfen NUR diesen
 * Typ benutzen — niemals direkt Betriebssystem-APIs.
 *
 * Implementierungen:
 *   - src/platform/macos    (jetzt)
 *   - src/platform/windows  (spaeter)
 */

/**
 * Aktueller Bedienmodus der App. Single source of truth — wird in main.ts
 * UND aus pill.html über das Preload importiert, damit Werte und Reihenfolge
 * konsistent bleiben.
 */
export type AppMode = "dictation" | "edit" | "conversation" | "file";

/** Reihenfolge für Doppeltipp-Cycle + Tray-Menü + Pillen-Badge. */
export const APP_MODES: readonly AppMode[] = [
  "dictation", "edit", "conversation", "file",
] as const;

/** Anzeigetexte (Deutsch) für UI und Tray. */
export const APP_MODE_LABELS: Readonly<Record<AppMode, string>> = {
  dictation: "Diktat",
  edit:      "Bearbeiten",
  conversation: "Gespräch",
  file:      "Datei",
};

/** Status der vom Nutzer zu erteilenden Systemberechtigungen. */
export interface PermissionStatus {
  /** Mikrofon — noetig fuer die Sprachaufnahme. */
  microphone: boolean;
  /** Eingabeueberwachung — noetig fuer die globale Tastenerfassung. */
  inputMonitoring: boolean;
  /** Bedienungshilfen — noetig zum Lesen und Einfuegen von Text. */
  accessibility: boolean;
  /** Bildschirmaufnahme — noetig fuer Quick-Look- und Fenster-Screenshots. */
  screenRecording: boolean;
}

/** Ereignisse des globalen Hotkeys. */
export interface HotkeyHandlers {
  /**
   * Beide Modifier-Tasten wurden gedrückt — Aufnahme wird VORBEREITET.
   * Wird sofort gefeuert, ohne auf den Hold-Threshold zu warten. Damit
   * läuft das Öffnen des Mikrofons parallel zur Reaktionszeit des Nutzers.
   * Falls anschließend `onPrepareCancel` statt `onHoldStart` kommt, wird
   * die Aufnahme verworfen.
   */
  onPrepareStart: () => void;
  /** Hold-Threshold überschritten — Aufnahme ist bestätigt, UI auf "Aufnahme". */
  onHoldStart: () => void;
  /** Hold beendet — Aufnahme verarbeiten. */
  onHoldEnd: () => void;
  /** Vor dem Hold-Threshold losgelassen (Tap) — vorbereitete Aufnahme verwerfen. */
  onPrepareCancel: () => void;
  /** Doppeltipp auf die Tastenkombination — Moduswechsel. */
  onDoubleTap: () => void;
}

/**
 * Welche zwei Modifier-Tasten den Hotkey bilden. Reihenfolge im String
 * ist nicht relevant — "cmd+alt" und "alt+cmd" verhalten sich identisch.
 *
 * Auf Windows wird "cmd" implementierungsseitig auf die Windows-Taste
 * abgebildet (siehe `src/platform/windows`).
 */
export type HotkeyCombo =
  | "cmd+alt"
  | "cmd+ctrl"
  | "cmd+shift"
  | "ctrl+alt"
  | "ctrl+shift"
  | "alt+shift";

/** Default-Hotkey, wenn in den Einstellungen nichts hinterlegt ist. */
export const DEFAULT_HOTKEY: HotkeyCombo = "cmd+alt";

/**
 * Rückgabetyp von resolveFileContext — entweder ein Dateipfad (klassisch)
 * oder ein extrahierter Artikel-Text (wenn ein Browser im Vordergrund ist
 * und der Inhalt erfolgreich gelesen werden konnte).
 */
export type FileContext =
  | { kind: "file"; path: string }
  | { kind: "article"; url: string; title: string; text: string };

/**
 * Plattformspezifische Funktionen. Jede Zielplattform liefert genau
 * eine Implementierung dieser Schnittstelle.
 */
export interface PlatformAdapter {
  /** Name der Plattform, z. B. "macos". */
  readonly name: string;

  /**
   * Registriert den globalen Hotkey (Halten + Doppeltipp). Kann beliebig
   * oft mit unterschiedlichem `combo` aufgerufen werden — die Implementierung
   * tauscht intern die Listener.
   */
  registerHotkey(handlers: HotkeyHandlers, combo: HotkeyCombo): Promise<void>;
  /** Entfernt den globalen Hotkey wieder. */
  unregisterHotkey(): Promise<void>;

  /** Liest den aktuell markierten Text der aktiven Anwendung. */
  readSelectedText(): Promise<string>;
  /** Fuegt Text an der aktuellen Cursorposition ein. */
  insertText(text: string): Promise<void>;

  /**
   * Gibt den Pfad der im Finder/Desktop markierten Datei zurück,
   * oder null wenn keine Datei markiert ist.
   */
  readSelectedFile(): Promise<string | null>;
  /**
   * Erstellt einen Screenshot des vordersten Fensters (Fallback: ganzer
   * Bildschirm) und gibt den Pfad zur temporären PNG-Datei zurück.
   */
  captureActiveWindow(): Promise<string>;
  /**
   * Ermittelt den passenden Datei-Kontext anhand der aktiven Anwendung.
   * Variante "file":    Pfad zu einer Datei oder einem Screenshot.
   * Variante "article": extrahierter Artikel-Text einer Webseite (Safari).
   * null wenn kein Kontext ermittelt werden konnte.
   */
  resolveFileContext(): Promise<FileContext | null>;

  /** Prueft, welche Systemberechtigungen bereits erteilt sind. */
  checkPermissions(): Promise<PermissionStatus>;
  /** Oeffnet die passenden Systemeinstellungen fuer eine fehlende Berechtigung. */
  openPermissionSettings(permission: keyof PermissionStatus): Promise<void>;

  /** Liest Text ueber die System-Sprachausgabe vor (TTS). */
  speak(text: string): Promise<void>;
  /** Bricht eine laufende Sprachausgabe ab. */
  stopSpeaking(): void;

  /**
   * Setzt das Dock-/Taskbar-Icon der laufenden App. Wird auf gepackten
   * Builds aus dem .icns gelesen; hier hauptsaechlich fuer den Dev-Modus
   * relevant, damit nicht das Default-Electron-Icon erscheint.
   */
  setAppIcon(iconPath: string): void;

  /**
   * Registriert einen Cancel-Hotkey (z. B. Escape), der waehrend laufender
   * TTS aktiv ist und den uebergebenen Callback feuert. Wird durch
   * `unregisterSpeakInterrupt` wieder entfernt.
   */
  registerSpeakInterrupt(cb: () => void): void;
  unregisterSpeakInterrupt(): void;
}

/** Liefert die Implementierung fuer das aktuelle Betriebssystem. */
export function createPlatformAdapter(
  getWindowSources: () => Promise<{ id: string; name: string }[]>,
): PlatformAdapter {
  if (process.platform === "darwin") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MacOSAdapter } = require("./macos/index") as typeof import("./macos/index");
    return new MacOSAdapter(getWindowSources);
  }
  if (process.platform === "win32") {
    console.warn(
      "JARVIS: Windows-Adapter ist ein Skelett — die meisten Funktionen werfen " +
        "NotImplementedError. Siehe src/platform/windows/index.ts.",
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WindowsAdapter } = require("./windows/index") as typeof import("./windows/index");
    return new WindowsAdapter(getWindowSources);
  }
  throw new Error(`Plattform nicht unterstuetzt: ${process.platform}`);
}
