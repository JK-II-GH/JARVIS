import { shell, clipboard } from "electron";
import { exec } from "child_process";
import { promisify } from "util";
import type { PlatformAdapter, HotkeyHandlers, PermissionStatus } from "../index";
import { MacHotkey } from "./hotkey";
import { checkPermissions, requestMicrophonePermission } from "./permissions";
import { insertText } from "./textInsert";

const execAsync = promisify(exec);

export class MacOSAdapter implements PlatformAdapter {
  readonly name = "macos";
  private hotkey = new MacHotkey();

  async registerHotkey(handlers: HotkeyHandlers): Promise<void> {
    await this.hotkey.register(handlers);
  }

  async unregisterHotkey(): Promise<void> {
    await this.hotkey.unregister();
  }

  async readSelectedText(): Promise<string> {
    // Sentinel-Wert setzen, damit wir Änderungen sicher erkennen
    const sentinel = "\x00JARVIS_SENTINEL\x00";
    const previous = clipboard.readText();
    clipboard.writeText(sentinel);

    // Cmd+C simulieren — wird erst nach Loslassen des Hotkeys aufgerufen,
    // damit keine Modifier-Tasten mehr gehalten sind
    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "c" using {command down}'`,
    );
    await new Promise<void>((r) => setTimeout(r, 200));

    const selected = clipboard.readText();
    clipboard.writeText(previous);
    return selected === sentinel ? "" : selected;
  }

  async insertText(text: string): Promise<void> {
    await insertText(text);
  }

  async checkPermissions(): Promise<PermissionStatus> {
    return checkPermissions();
  }

  async openPermissionSettings(permission: keyof PermissionStatus): Promise<void> {
    const urlMap: Record<keyof PermissionStatus, string> = {
      microphone:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      inputMonitoring:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
      accessibility:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    };
    await shell.openExternal(urlMap[permission]);
  }

  async speak(text: string): Promise<void> {
    // Einfache System-TTS über macOS say-Befehl (Phase 3 verfeinern)
    exec(`say ${JSON.stringify(text)}`);
  }

  stopSpeaking(): void {
    exec("killall say");
  }
}

export { requestMicrophonePermission };
