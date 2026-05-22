import OpenAI from "openai";
import type { AIProvider } from "./AIProvider";

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
}
