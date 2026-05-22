export interface AIProvider {
  /** Wendet einen Sprachbefehl auf einen markierten Text an und gibt das Ergebnis zurück. */
  process(selectedText: string, command: string): Promise<string>;
}
