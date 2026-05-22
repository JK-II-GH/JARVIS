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
    // Websuche über Anthropics eingebautes web_search-Tool (Beta)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = [{ type: "web_search_20250305", name: "web_search" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: "user", content: message }];

    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (this.client.messages.create as any)(
        { model: "claude-sonnet-4-6", max_tokens: 1024, system: CHAT_SYSTEM_PROMPT, tools, messages },
        { headers: { "anthropic-beta": "web-search-2025-03-05" } },
      );

      if (response.stop_reason === "end_turn") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = response.content.find((b: any) => b.type === "text");
        return text?.text.trim() ?? "";
      }

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = response.content
          .filter((b: any) => b.type === "tool_use")
          .map((b: any) => ({ type: "tool_result", tool_use_id: b.id, content: [] }));
        if (results.length) messages.push({ role: "user", content: results });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = response.content.find((b: any) => b.type === "text");
        return text?.text.trim() ?? "";
      }
    }
    return "";
  }
}
