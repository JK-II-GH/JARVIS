import OpenAI from "openai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { STTProvider } from "./STTProvider";
import type { SttConfig } from "../settings";

export class WhisperProvider implements STTProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: SttConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model;
  }

  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";
    const tmpFile = path.join(os.tmpdir(), `jarvis_${Date.now()}.${ext}`);

    fs.writeFileSync(tmpFile, audio);
    try {
      const response = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile),
        model: this.model,
      });
      return response.text.trim();
    } finally {
      fs.unlink(tmpFile, () => undefined);
    }
  }
}
