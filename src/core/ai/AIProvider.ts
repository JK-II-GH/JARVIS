export interface AIProvider {
  /** Wendet einen Sprachbefehl auf einen markierten Text an und gibt das Ergebnis zurück. */
  process(selectedText: string, command: string): Promise<string>;
  /** Freie Unterhaltung — gibt die KI-Antwort als Text zurück. */
  chat(message: string): Promise<string>;
  /** Bild oder PDF als Kontext + Sprachfrage → KI-Antwort als Text. */
  chatWithFile(filePath: string, question: string): Promise<string>;
}
