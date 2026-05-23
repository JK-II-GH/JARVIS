import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import type { AIProvider } from "./AIProvider";

const IMAGE_MIMES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png",  ".gif": "image/gif",  ".webp": "image/webp",
};

const EDIT_SYSTEM_PROMPT =
  "Du bist ein Textbearbeitungs-Assistent. Wende den Nutzerbefehl präzise auf den " +
  "gegebenen Text an. Gib ausschließlich den bearbeiteten Text zurück — keine " +
  "Erklärungen, keine Anführungszeichen, keinen Rahmen.";

const CHAT_SYSTEM_PROMPT =
  "Du bist JARVIS, ein Sprachassistent. Deine Antwort wird mit Text-to-Speech vorgelesen. " +
  "Schreibe ausschließlich fließenden Fließtext — KEIN Markdown, keine Sternchen, keine Rauten, " +
  "keine Bindestriche als Aufzählung, keine horizontalen Linien. " +
  "Fasse dich kurz und natürlich.";

export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async process(selectedText: string, command: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2048,
      messages: [
        { role: "system", content: EDIT_SYSTEM_PROMPT },
        { role: "user", content: `Befehl: ${command}\n\nText:\n${selectedText}` },
      ],
    });
    return response.choices[0]?.message.content?.trim() ?? "";
  }

  async chat(message: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1024,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
    });
    return response.choices[0]?.message.content?.trim() ?? "";
  }

  async chatWithFile(filePath: string, question: string): Promise<string> {
    const ext  = path.extname(filePath).toLowerCase();
    const mime = IMAGE_MIMES[ext];
    if (!mime) throw new Error(`OpenAI unterstützt nur Bilder (jpg, png, gif, webp), nicht "${ext}".`);

    const base64 = fs.readFileSync(filePath).toString("base64");
    const response = await this.client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1024,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
            { type: "text", text: question },
          ],
        },
      ],
    });
    return response.choices[0]?.message.content?.trim() ?? "";
  }
}
