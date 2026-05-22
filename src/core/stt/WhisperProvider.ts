import OpenAI from "openai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { STTProvider } from "./STTProvider";

export class WhisperProvider implements STTProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    // Erweiterung aus MIME-Typ ableiten
    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";
    const tmpFile = path.join(os.tmpdir(), `jarvis_${Date.now()}.${ext}`);

    fs.writeFileSync(tmpFile, audio);
    try {
      const response = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile),
        model: "whisper-1",
      });
      return response.text.trim();
    } finally {
      fs.unlink(tmpFile, () => undefined);
    }
  }
}
