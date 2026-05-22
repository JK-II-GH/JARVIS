# Hinweise für Claude Code — Projekt JARVIS

## Vor jeder Sitzung

1. Lies `FOUNDATIONS.md` — Vision und Architektur. Das ist die Quelle der Wahrheit.
2. Lies `docs/STATUS.md` — finde die aktuelle Phase und den nächsten offenen Punkt.
3. Arbeite den nächsten offenen Punkt ab und hake ihn anschließend in
   `docs/STATUS.md` ab.

## Architekturregeln (nicht verletzen)

- Plattformspezifischer Code (Hotkey, Texteinfügen, Berechtigungen, TTS) gehört
  AUSSCHLIESSLICH nach `src/platform/`. Die Kernlogik (`src/core/`) und die
  Oberfläche (`src/renderer/`) kennen nur die Schnittstelle aus
  `src/platform/index.ts`.
- Spracherkennung und KI-Anbieter laufen über austauschbare Schnittstellen
  (`STTProvider`, `AIProvider`). Keine direkten API-Aufrufe in der Kernlogik.
- macOS zuerst. Windows-Code kommt später nach `src/platform/windows/` — ohne
  Änderungen an `src/core/` oder `src/renderer/`.

## Arbeitsweise

- Erst die kleinste lauffähige Version einer Phase, dann verfeinern.
- Neue Erkenntnisse in `FOUNDATIONS.md` bzw. `docs/STATUS.md` festhalten.
- API-Schlüssel niemals in den Code oder ins Repository schreiben — sie werden
  nur zur Laufzeit im App-Datenverzeichnis gespeichert.
- Sprache: Dokumentation und Oberfläche auf Deutsch, Code-Bezeichner auf
  Englisch, Kommentare auf Deutsch.

## Tech-Stack

- Electron + TypeScript
- Globale Tastenerfassung über ein natives Key-Listener-Modul (Halten + Doppeltipp)
- STT: Whisper-API (Cloud), später whisper.cpp (lokal)
- KI: Anthropic und OpenAI, in den Einstellungen umschaltbar
- TTS: System-Sprachausgabe
