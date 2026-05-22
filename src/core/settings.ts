import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

interface SettingsData {
  openaiApiKey?: string;
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

  get openaiApiKey(): string | undefined {
    return this.data.openaiApiKey;
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

  setOpenAIKey(key: string): void {
    this.data.openaiApiKey = key;
    this.save();
  }
}
