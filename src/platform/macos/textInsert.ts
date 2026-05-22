import { clipboard } from "electron";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function insertText(text: string): Promise<void> {
  const previous = clipboard.readText();
  clipboard.writeText(text);

  await execAsync(
    `osascript -e 'tell application "System Events" to keystroke "v" using {command down}'`,
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  clipboard.writeText(previous);
}
