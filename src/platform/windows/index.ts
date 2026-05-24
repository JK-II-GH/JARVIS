/**
 * Windows-Adapter — SKELETT.
 *
 * Status: Architektur-Gerüst. Wird erst auf echtem Windows-Gerät implementiert.
 * Alle Methoden werfen aktuell NotImplementedError. Wenn dieser Adapter
 * instanziiert wird (process.platform === "win32"), gibt index.ts darüber
 * einen deutlichen Hinweis aus.
 *
 * Empfohlene Reihenfolge der Umsetzung:
 *   1. registerHotkey       — uiohook-napi funktioniert plattformübergreifend,
 *                             Tasten-Mapping anpassen (Ctrl+Alt o.ä.)
 *   2. insertText           — Zwischenablage + simuliertes Ctrl+V
 *   3. readSelectedText     — Zwischenablage + simuliertes Ctrl+C
 *   4. checkPermissions     — Windows hat kein vergleichbares TCC,
 *                             checkPermissions kann alles true zurückgeben
 *   5. speak / stopSpeaking — PowerShell SpeechSynthesizer oder edge-tts
 *   6. resolveFileContext   — Win32 BringWindowToTop + screen-capture
 *                             (Electron desktopCapturer reicht u. U. schon)
 */

import type { PlatformAdapter, HotkeyHandlers, HotkeyCombo, PermissionStatus, FileContext } from "../index";

class NotImplementedError extends Error {
  constructor(method: string) {
    super(
      `Windows-Adapter: ${method} ist noch nicht implementiert. ` +
        `Beitrag willkommen — siehe src/platform/windows/index.ts.`,
    );
  }
}

export class WindowsAdapter implements PlatformAdapter {
  readonly name = "windows";

  constructor(
    // Identisches Konstruktor-Interface wie der macOS-Adapter,
    // damit createPlatformAdapter() unverändert bleibt.
    private readonly _getWindowSources: () => Promise<{ id: string; name: string }[]>,
  ) {
    void this._getWindowSources;
  }

  async registerHotkey(_handlers: HotkeyHandlers, _combo: HotkeyCombo): Promise<void> {
    throw new NotImplementedError("registerHotkey");
  }

  async unregisterHotkey(): Promise<void> {
    // No-op — der Hotkey ist ohnehin nie registriert worden.
  }

  async readSelectedText(): Promise<string> {
    throw new NotImplementedError("readSelectedText");
  }

  async insertText(_text: string): Promise<void> {
    throw new NotImplementedError("insertText");
  }

  async checkPermissions(): Promise<PermissionStatus> {
    // Windows hat kein vergleichbares Berechtigungssystem für diese
    // Funktionen — Mikrofon-Zugriff regelt der Browser-Prompt im Renderer.
    return {
      microphone: true,
      inputMonitoring: true,
      accessibility: true,
      screenRecording: true,
    };
  }

  async openPermissionSettings(_permission: keyof PermissionStatus): Promise<void> {
    // Windows kennt diese Einstellungen so nicht; absichtlich No-op.
  }

  async speak(_text: string): Promise<void> {
    throw new NotImplementedError("speak");
  }

  stopSpeaking(): void {
    // No-op — keine TTS-Implementierung vorhanden.
  }

  async readSelectedFile(): Promise<string | null> {
    throw new NotImplementedError("readSelectedFile");
  }

  async captureActiveWindow(): Promise<string> {
    throw new NotImplementedError("captureActiveWindow");
  }

  async resolveFileContext(): Promise<FileContext | null> {
    throw new NotImplementedError("resolveFileContext");
  }

  setAppIcon(_iconPath: string): void {
    // Windows: kein Dock — sinnvollerweise wird das App-Icon vom Build
    // gesetzt. Hier No-op.
  }

  registerSpeakInterrupt(_cb: () => void): void {
    // Wird erst sinnvoll, wenn der TTS-Pfad auf Windows steht.
  }

  unregisterSpeakInterrupt(): void {
    // No-op — siehe registerSpeakInterrupt.
  }
}
