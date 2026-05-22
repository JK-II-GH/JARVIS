import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

interface SettingsData {
  openaiApiKey?: string;
  groqApiKey?: string;
  anthropicApiKey?: string;
  perplexityApiKey?: string;
  aiProvider?: "anthropic" | "openai";
}

export interface SttConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface AiConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
}

export class SettingsManager {
  private readonly filePath: string;
  private data: SettingsData;

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "settings.json");
    this.data = this.load();
  }

  get settingsFilePath(): string {
    return this.filePath;
  }

  // Groq hat Vorrang vor OpenAI, da kostenlos und schneller
  getSttConfig(): SttConfig | null {
    if (this.data.groqApiKey) {
      return {
        apiKey: this.data.groqApiKey,
        baseURL: "https://api.groq.com/openai/v1",
        model: "whisper-large-v3-turbo",
      };
    }
    if (this.data.openaiApiKey) {
      return { apiKey: this.data.openaiApiKey, model: "whisper-1" };
    }
    return null;
  }

  getAiConfig(): AiConfig | null {
    const preferred = this.data.aiProvider ?? "anthropic";
    if (preferred === "openai" && this.data.openaiApiKey) {
      return { provider: "openai", apiKey: this.data.openaiApiKey };
    }
    if (this.data.anthropicApiKey) {
      return { provider: "anthropic", apiKey: this.data.anthropicApiKey };
    }
    if (this.data.openaiApiKey) {
      return { provider: "openai", apiKey: this.data.openaiApiKey };
    }
    return null;
  }

  getPerplexityApiKey(): string | null {
    return this.data.perplexityApiKey ?? null;
  }

  getRawKeys(): { anthropicApiKey: string; openaiApiKey: string; groqApiKey: string } {
    return {
      anthropicApiKey: this.data.anthropicApiKey ?? "",
      openaiApiKey:    this.data.openaiApiKey    ?? "",
      groqApiKey:      this.data.groqApiKey      ?? "",
    };
  }

  setAiProvider(provider: "anthropic" | "openai"): void {
    this.data.aiProvider = provider;
    this.save();
  }

  getAiProvider(): "anthropic" | "openai" {
    return this.data.aiProvider ?? "anthropic";
  }

  private load(): SettingsData {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}
