import { uIOhook, UiohookKey } from "uiohook-napi";
import type { HotkeyHandlers } from "../index";

// Erkennt linke und rechte Varianten der Modifier-Tasten
const isCmd = (code: number) =>
  code === UiohookKey.Meta || code === UiohookKey.MetaRight;
const isAlt = (code: number) =>
  code === UiohookKey.Alt || code === UiohookKey.AltRight;

// Taps kürzer als dieser Schwellwert starten keine Aufnahme — nur Doppeltipp
const TAP_THRESHOLD_MS = 250;
// Maximale Pause zwischen zwei Taps für Doppeltipp-Erkennung
const DOUBLE_TAP_WINDOW_MS = 500;

export class MacHotkey {
  private cmdDown = false;
  private altDown = false;
  private holdActive = false;
  private pressTime = 0;
  private isHolding = false; // true sobald Schwellwert überschritten
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  private lastReleaseTime = 0;
  private tapCount = 0;

  async register(handlers: HotkeyHandlers): Promise<void> {
    uIOhook.on("keydown", (e) => {
      if (isCmd(e.keycode)) this.cmdDown = true;
      if (isAlt(e.keycode)) this.altDown = true;

      if (this.cmdDown && this.altDown && !this.holdActive) {
        this.holdActive = true;
        this.pressTime = Date.now();
        // Aufnahme erst starten wenn Tasten länger als TAP_THRESHOLD_MS gehalten
        this.holdTimer = setTimeout(() => {
          if (this.holdActive) {
            this.isHolding = true;
            handlers.onHoldStart();
          }
        }, TAP_THRESHOLD_MS);
      }
    });

    uIOhook.on("keyup", (e) => {
      const wasBoth = this.cmdDown && this.altDown;

      if (isCmd(e.keycode)) this.cmdDown = false;
      if (isAlt(e.keycode)) this.altDown = false;

      if (this.holdActive && wasBoth && (!this.cmdDown || !this.altDown)) {
        this.holdActive = false;

        if (this.holdTimer) {
          clearTimeout(this.holdTimer);
          this.holdTimer = null;
        }

        if (this.isHolding) {
          // Echter Hold: Aufnahme beenden
          this.isHolding = false;
          this.tapCount = 0;
          handlers.onHoldEnd();
        } else {
          // Kurzer Tap: Doppeltipp-Erkennung, keine Aufnahme
          const now = Date.now();
          if (now - this.lastReleaseTime < DOUBLE_TAP_WINDOW_MS) {
            this.tapCount++;
            if (this.tapCount >= 2) {
              this.tapCount = 0;
              handlers.onDoubleTap();
            }
          } else {
            this.tapCount = 1;
          }
          this.lastReleaseTime = now;
        }
      }
    });

    uIOhook.start();
  }

  async unregister(): Promise<void> {
    uIOhook.stop();
  }
}
