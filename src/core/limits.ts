/**
 * Geteilte Größen-/Längen-Limits, damit sie nicht an mehreren Stellen
 * driftend hartcodiert sind.
 */

/** Maximale Dateigröße für Datei-Kontext (Anthropic-API-Limit). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
