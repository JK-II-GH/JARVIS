import { uIOhook, UiohookKey } from "uiohook-napi";
import type { HotkeyHandlers } from "../index";

// Erkennt linke und rechte Varianten der Modifier-Tasten
const isCmd = (code: number) =>
  code === UiohookKey.Meta || code === UiohookKey.MetaRight;
const isAlt = (code: number) =>
  code === UiohookKey.Alt || code === UiohookKey.AltRight;

export class MacHotkey {
  private cmdDown = false;
  private altDown = false;
  private holdActive = false;

  // Doppeltipp-Erkennung: zwei schnelle Tap-Zyklen ohne Halten
  private lastReleaseTime = 0;
  private tapCount = 0;

  async register(handlers: HotkeyHandlers): Promise<void> {
    uIOhook.on("keydown", (e) => {
      if (isCmd(e.keycode)) this.cmdDown = true;
      if (isAlt(e.keycode)) this.altDown = true;

      if (this.cmdDown && this.altDown && !this.holdActive) {
        this.holdActive = true;
        handlers.onHoldStart();
      }
    });

    uIOhook.on("keyup", (e) => {
      const wasBoth = this.cmdDown && this.altDown;

      if (isCmd(e.keycode)) this.cmdDown = false;
      if (isAlt(e.keycode)) this.altDown = false;

      if (this.holdActive && wasBoth && (!this.cmdDown || !this.altDown)) {
        this.holdActive = false;

        const now = Date.now();
        if (now - this.lastReleaseTime < 400) {
          this.tapCount++;
          if (this.tapCount >= 2) {
            this.tapCount = 0;
            handlers.onDoubleTap();
          }
        } else {
          this.tapCount = 1;
        }
        this.lastReleaseTime = now;

        handlers.onHoldEnd();
      }
    });

    uIOhook.start();
  }

  async unregister(): Promise<void> {
    uIOhook.stop();
  }
}
