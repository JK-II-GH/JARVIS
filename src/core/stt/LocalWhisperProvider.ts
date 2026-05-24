import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { STTProvider } from "./STTProvider";

/**
 * Lokale Spracherkennung via whisper.cpp (`whisper-cli`-Binary).
 *
 * Erwartet ein WAV mit beliebigem Sample-Rate — whisper.cpp resampelt
 * intern auf 16 kHz. Ausgabe: reines Transkript ohne Timestamps.
 */
export class LocalWhisperProvider implements STTProvider {
  constructor(
    private readonly binaryPath: string,
    private readonly modelPath: string,
    /** ISO-Sprachcode oder "auto" für Auto-Detect. */
    private readonly language: string = "auto",
  ) {}

  async transcribe(audio: Buffer, _mimeType: string): Promise<string> {
    const tmpWav = path.join(os.tmpdir(), `jarvis_local_${Date.now()}.wav`);
    fs.writeFileSync(tmpWav, audio);

    try {
      const args = [
        "-m", this.modelPath,
        "-f", tmpWav,
        "-l", this.language,
        "-np",   // keine sonstigen Logs, nur das Ergebnis
        "-nt",   // keine Timestamps
        "-t", String(Math.max(2, Math.floor((os.cpus().length || 4) / 2))),
      ];

      const text = await run(this.binaryPath, args);
      return text.trim();
    } finally {
      fs.unlink(tmpWav, () => undefined);
    }
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b) => (stderr += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`whisper-cli exit ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      resolve(stdout);
    });
  });
}
