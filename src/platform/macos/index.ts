import { shell, clipboard } from "electron";
import { exec, type ChildProcess } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import type { PlatformAdapter, HotkeyHandlers, PermissionStatus } from "../index";

const SCREENSHOT_PATH = path.join(os.tmpdir(), "jarvis_screenshot.png");
import { MacHotkey } from "./hotkey";
import { checkPermissions, requestMicrophonePermission } from "./permissions";
import { insertText } from "./textInsert";

const execAsync = promisify(exec);

export class MacOSAdapter implements PlatformAdapter {
  readonly name = "macos";
  private hotkey = new MacHotkey();
  private sayProcess: ChildProcess | null = null;

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
    return new Promise<void>((resolve) => {
      this.sayProcess = exec(`say ${JSON.stringify(text)}`, () => {
        this.sayProcess = null;
        resolve();
      });
    });
  }

  stopSpeaking(): void {
    if (this.sayProcess) {
      this.sayProcess.kill();
      this.sayProcess = null;
    }
  }

  async readSelectedFile(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "Finder"
          try
            set sel to selection
            if (count of sel) > 0 then
              return POSIX path of (item 1 of sel as alias)
            end if
          end try
        end tell'`,
      );
      const p = stdout.trim();
      return p || null;
    } catch {
      return null;
    }
  }

  async resolveFileContext(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
      );
      const frontApp = stdout.trim();
      console.log(`JARVIS: Vorderste App = "${frontApp}"`);

      if (frontApp === "Finder") {
        // Quick Look offen? → Screenshot des QL-Fensters
        const qlPath = await this.captureQuickLookIfOpen();
        if (qlPath) return qlPath;
        // Normaler Finder/Desktop → markierte Datei lesen
        return await this.readSelectedFile();
      } else {
        // Andere App → Screenshot des aktiven Fensters
        return await this.captureActiveWindow();
      }
    } catch {
      return null;
    }
  }

  private async captureQuickLookIfOpen(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events"
          set qlProcs to (every process whose name contains "QuickLook")
          if (count of qlProcs) = 0 then return ""
          set qlProc to item 1 of qlProcs
          if (count of windows of qlProc) = 0 then return ""
          try
            set w to first window of qlProc
            set {x, y} to position of w
            set {ww, wh} to size of w
            return (x as string) & "," & (y as string) & "," & (ww as string) & "," & (wh as string)
          on error
            return "fullscreen"
          end try
        end tell'`,
      );
      const result = stdout.trim();
      if (!result) return null;
      if (result === "fullscreen") {
        await execAsync(`screencapture -x "${SCREENSHOT_PATH}"`);
      } else {
        await execAsync(`screencapture -x -R "${result}" "${SCREENSHOT_PATH}"`);
      }
      console.log(`JARVIS: Quick Look erkannt → Screenshot (${result})`);
      return SCREENSHOT_PATH;
    } catch {
      return null;
    }
  }

  async captureActiveWindow(): Promise<string> {
    try {
      // Bounds des vordersten Fensters ermitteln
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events"
          set p to first process whose frontmost is true
          try
            set w to first window of p
            set {x, y} to position of w
            set {ww, wh} to size of w
            return (x as string) & "," & (y as string) & "," & (ww as string) & "," & (wh as string)
          end try
        end tell'`,
      );
      const bounds = stdout.trim();
      if (bounds) {
        await execAsync(`screencapture -x -R "${bounds}" "${SCREENSHOT_PATH}"`);
      } else {
        await execAsync(`screencapture -x "${SCREENSHOT_PATH}"`);
      }
    } catch {
      // Fallback: ganzer Bildschirm
      await execAsync(`screencapture -x "${SCREENSHOT_PATH}"`);
    }
    return SCREENSHOT_PATH;
  }
}

export { requestMicrophonePermission };
