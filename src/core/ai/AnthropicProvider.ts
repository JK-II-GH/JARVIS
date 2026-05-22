import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider } from "./AIProvider";

const EDIT_SYSTEM_PROMPT =
  "Du bist ein Textbearbeitungs-Assistent. Wende den Nutzerbefehl präzise auf den " +
  "gegebenen Text an. Gib ausschließlich den bearbeiteten Text zurück — keine " +
  "Erklärungen, keine Anführungszeichen, keinen Rahmen.";

const CHAT_SYSTEM_PROMPT =
  "Du bist JARVIS, ein hilfreicher Sprach-KI-Assistent auf dem Desktop. " +
  "Antworte prägnant und natürlich gesprochen — deine Antwort wird vorgelesen. " +
  "Keine Markdown-Formatierung, keine Aufzählungszeichen, keine Überschriften.";

export class AnthropicProvider implements AIProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async process(selectedText: string, command: string): Promise<string> {
    const message = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: EDIT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Befehl: ${command}\n\nText:\n${selectedText}` }],
    });
    const block = message.content[0];
    return block.type === "text" ? block.text.trim() : "";
  }

  async chat(message: string): Promise<string> {
    const response = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: CHAT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    });
    const block = response.content[0];
    return block.type === "text" ? block.text.trim() : "";
  }
}
