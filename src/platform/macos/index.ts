import { shell } from "electron";
import { exec } from "child_process";
import type { PlatformAdapter, HotkeyHandlers, PermissionStatus } from "../index";
import { MacHotkey } from "./hotkey";
import { checkPermissions, requestMicrophonePermission } from "./permissions";
import { insertText } from "./textInsert";

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
    // Phase 2: markierten Text über Zwischenablage auslesen
    return "";
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
