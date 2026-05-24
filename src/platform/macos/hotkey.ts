import { uIOhook, UiohookKey } from "uiohook-napi";
import type { HotkeyHandlers, HotkeyCombo } from "../index";

/** Welche Modifier-Tasten unterstützen wir als Hotkey-Bestandteil? */
type ModifierKey = "cmd" | "alt" | "ctrl" | "shift";

/**
 * Mapping: Modifier-Name → Test-Funktion, ob der Keycode (links oder rechts)
 * zu dieser Taste gehört.
 */
const MODIFIER_MATCHERS: Record<ModifierKey, (code: number) => boolean> = {
  cmd:   (c) => c === UiohookKey.Meta  || c === UiohookKey.MetaRight,
  alt:   (c) => c === UiohookKey.Alt   || c === UiohookKey.AltRight,
  ctrl:  (c) => c === UiohookKey.Ctrl  || c === UiohookKey.CtrlRight,
  shift: (c) => c === UiohookKey.Shift || c === UiohookKey.ShiftRight,
};

// Taps kürzer als dieser Schwellwert starten keine Aufnahme — nur Doppeltipp
const TAP_THRESHOLD_MS = 250;
// Maximale Pause zwischen zwei Taps für Doppeltipp-Erkennung
const DOUBLE_TAP_WINDOW_MS = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KeyEvent = { keycode: number };
type KeyListener = (e: KeyEvent) => void;

export class MacHotkey {
  private mod1Down = false;
  private mod2Down = false;
  private holdActive = false;
  private isHolding = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  private lastReleaseTime = 0;
  private tapCount = 0;

  // Aktuell installierte Listener — werden beim Re-Register entfernt
  private keydownFn: KeyListener | null = null;
  private keyupFn:   KeyListener | null = null;
  private started = false;

  /**
   * Registriert den Hotkey. Mehrfacher Aufruf mit anderem `combo` tauscht
   * intern die Listener — uIOhook wird nicht zwischendurch gestoppt.
   */
  async register(handlers: HotkeyHandlers, combo: HotkeyCombo): Promise<void> {
    this.removeListeners();
    this.resetState();

    const [m1, m2] = combo.split("+") as ModifierKey[];
    const match1 = MODIFIER_MATCHERS[m1];
    const match2 = MODIFIER_MATCHERS[m2];
    if (!match1 || !match2) {
      throw new Error(`Unbekannte Hotkey-Kombination: ${combo}`);
    }

    const keydown: KeyListener = (e) => {
      if (match1(e.keycode)) this.mod1Down = true;
      if (match2(e.keycode)) this.mod2Down = true;

      if (this.mod1Down && this.mod2Down && !this.holdActive) {
        this.holdActive = true;
        // Aufnahme SOFORT vorbereiten — Mikrofon-Öffnen läuft parallel zur
        // Reaktionszeit des Nutzers. Wird bei Tap später verworfen.
        handlers.onPrepareStart();
        this.holdTimer = setTimeout(() => {
          if (this.holdActive) {
            this.isHolding = true;
            handlers.onHoldStart();
          }
        }, TAP_THRESHOLD_MS);
      }
    };

    const keyup: KeyListener = (e) => {
      const wasBoth = this.mod1Down && this.mod2Down;

      if (match1(e.keycode)) this.mod1Down = false;
      if (match2(e.keycode)) this.mod2Down = false;

      if (this.holdActive && wasBoth && (!this.mod1Down || !this.mod2Down)) {
        this.holdActive = false;

        if (this.holdTimer) {
          clearTimeout(this.holdTimer);
          this.holdTimer = null;
        }

        if (this.isHolding) {
          this.isHolding = false;
          this.tapCount = 0;
          handlers.onHoldEnd();
        } else {
          // Tap — die vorbereitete Aufnahme verwerfen
          handlers.onPrepareCancel();
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
    };

    uIOhook.on("keydown", keydown);
    uIOhook.on("keyup",   keyup);
    this.keydownFn = keydown;
    this.keyupFn   = keyup;

    if (!this.started) {
      uIOhook.start();
      this.started = true;
    }
  }

  async unregister(): Promise<void> {
    this.removeListeners();
    if (this.started) {
      uIOhook.stop();
      this.started = false;
    }
  }

  private removeListeners(): void {
    if (this.keydownFn) {
      uIOhook.off("keydown", this.keydownFn);
      this.keydownFn = null;
    }
    if (this.keyupFn) {
      uIOhook.off("keyup", this.keyupFn);
      this.keyupFn = null;
    }
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private resetState(): void {
    this.mod1Down = false;
    this.mod2Down = false;
    this.holdActive = false;
    this.isHolding = false;
    this.tapCount = 0;
    this.lastReleaseTime = 0;
  }
}
