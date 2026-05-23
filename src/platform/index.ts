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

/** Aktueller Bedienmodus der App. */
export type Mode =
  | "dictation"
  | "edit"
  | "conversation"
  | "fileContext"
  | "feedback";

/** Status der vom Nutzer zu erteilenden Systemberechtigungen. */
export interface PermissionStatus {
  /** Mikrofon — noetig fuer die Sprachaufnahme. */
  microphone: boolean;
  /** Eingabeueberwachung — noetig fuer die globale Tastenerfassung. */
  inputMonitoring: boolean;
  /** Bedienungshilfen — noetig zum Lesen und Einfuegen von Text. */
  accessibility: boolean;
}

/** Ereignisse des globalen Hotkeys. */
export interface HotkeyHandlers {
  /** Tasten wurden gedrueckt und gehalten — Aufnahme startet. */
  onHoldStart: () => void;
  /** Tasten wurden losgelassen — Aufnahme endet. */
  onHoldEnd: () => void;
  /** Doppeltipp auf die Tastenkombination — Moduswechsel. */
  onDoubleTap: () => void;
}

/**
 * Plattformspezifische Funktionen. Jede Zielplattform liefert genau
 * eine Implementierung dieser Schnittstelle.
 */
export interface PlatformAdapter {
  /** Name der Plattform, z. B. "macos". */
  readonly name: string;

  /** Registriert den globalen Hotkey (Halten + Doppeltipp). */
  registerHotkey(handlers: HotkeyHandlers): Promise<void>;
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
   * Ermittelt den passenden Datei-Kontext anhand der aktiven Anwendung:
   * - Finder/Desktop aktiv → markierte Datei
   * - Andere App aktiv    → Screenshot des aktiven Fensters
   * Gibt null zurück wenn kein Kontext ermittelt werden konnte.
   */
  resolveFileContext(): Promise<string | null>;

  /** Prueft, welche Systemberechtigungen bereits erteilt sind. */
  checkPermissions(): Promise<PermissionStatus>;
  /** Oeffnet die passenden Systemeinstellungen fuer eine fehlende Berechtigung. */
  openPermissionSettings(permission: keyof PermissionStatus): Promise<void>;

  /** Liest Text ueber die System-Sprachausgabe vor (TTS). */
  speak(text: string): Promise<void>;
  /** Bricht eine laufende Sprachausgabe ab. */
  stopSpeaking(): void;
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
