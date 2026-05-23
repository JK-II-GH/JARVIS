import Anthropic from "@anthropic-ai/sdk";
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

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")        // Überschriften
    .replace(/\*\*([^*]+)\*\*/g, "$1") // Fett
    .replace(/\*([^*]+)\*/g, "$1")     // Kursiv
    .replace(/^[-*•]\s+/gm, "")       // Aufzählungspunkte
    .replace(/---+/g, "")              // Trennlinien
    .replace(/\n{2,}/g, ". ")         // Absätze → kurze Pause
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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
    // Websuche über Anthropics eingebautes server-seitiges web_search-Tool (Beta).
    // Die Suche läuft vollständig server-seitig — kein Tool-Use-Round-Trip nötig.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (this.client.messages.create as any)(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: CHAT_SYSTEM_PROMPT,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: message }],
      },
      { headers: { "anthropic-beta": "web-search-2025-03-05" } },
    );

    // Antwort besteht aus mehreren Text-Blöcken — alle zusammenführen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text as string)
      .join(" ")
      .trim();

    return stripMarkdown(raw);
  }

  async chatWithFile(filePath: string, question: string): Promise<string> {
    const ext    = path.extname(filePath).toLowerCase();
    const base64 = fs.readFileSync(filePath).toString("base64");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fileBlock: any;
    const imageMime = IMAGE_MIMES[ext];
    if (imageMime) {
      fileBlock = { type: "image", source: { type: "base64", media_type: imageMime, data: base64 } };
    } else if (ext === ".pdf") {
      // PDF ist ab claude-3-5-sonnet-20241022 Standard — kein Beta-Header nötig
      fileBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
    } else {
      throw new Error(`Nicht unterstütztes Dateiformat: ${ext}`);
    }

    console.log(`JARVIS: Anthropic chatWithFile → ${ext}, ${(base64.length * 0.75 / 1024).toFixed(0)} KB`);
    const response = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: CHAT_SYSTEM_PROMPT,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: question }] }] as any,
    });
    console.log(`JARVIS: Anthropic chatWithFile → Antwort erhalten (${response.content.length} Blöcke)`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text as string)
      .join(" ")
      .trim();

    return stripMarkdown(raw);
  }
}
