import { clipboard } from "electron";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Wartezeit nach dem simulierten Cmd+V bevor der ursprüngliche Clipboard-
 * Inhalt restauriert wird. Zu kurz → die Zielapp hat noch nicht eingefügt
 * und kriegt den alten Inhalt. 250 ms sind ein solider Kompromiss zwischen
 * Tippgefühl und Robustheit (war vorher 150 ms — zu knapp bei langsamen
 * Apps).
 */
const PASTE_RESTORE_DELAY_MS = 250;

/**
 * Fügt Text an der aktuellen Cursorposition ein. Pragmatische Lösung über
 * Zwischenablage + simuliertes Cmd+V.
 *
 * Hinweis zur Zwischenablage: Wir sichern alle gängigen Clipboard-Formate
 * (Text, HTML, Image-Buffer), damit ein vorheriges Bild oder formatierter
 * Text nach dem Einfügen erhalten bleibt.
 */
export async function insertText(text: string): Promise<void> {
  const saved = saveClipboard();
  clipboard.writeText(text);

  try {
    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "v" using {command down}'`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, PASTE_RESTORE_DELAY_MS));
  } finally {
    restoreClipboard(saved);
  }
}

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf:  string;
  image: Electron.NativeImage | null;
}

function saveClipboard(): ClipboardSnapshot {
  const image = clipboard.readImage();
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf:  clipboard.readRTF(),
    image: image.isEmpty() ? null : image,
  };
}

function restoreClipboard(s: ClipboardSnapshot): void {
  if (s.image) {
    clipboard.writeImage(s.image);
  } else if (s.html || s.rtf) {
    clipboard.write({ text: s.text, html: s.html || undefined, rtf: s.rtf || undefined });
  } else {
    clipboard.writeText(s.text);
  }
}
