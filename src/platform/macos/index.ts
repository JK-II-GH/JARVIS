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

    // Markierten Text über Accessibility-API lesen — keine Tastensimulation,
    // damit der gehaltene Hotkey nicht vorzeitig ausgelöst wird
    const lines = [
      `tell application "System Events"`,
      `  set frontApp to first application process whose frontmost is true`,
      `  tell frontApp`,
      `    try`,
      `      set sel to value of attribute "AXSelectedText" of (focused UI element)`,
      `      if sel is missing value then return ""`,
      `      return sel`,
      `    on error`,
      `      return ""`,
      `    end try`,
      `  end tell`,
      `end tell`,
    ];
    const args = lines.map((l) => `-e ${JSON.stringify(l)}`).join(" ");
    const { stdout } = await execAsync(`osascript ${args}`).catch(() => ({ stdout: "" }));
    clipboard.writeText(previous); // Zwischenablage wiederherstellen
    return stdout.trim();
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
