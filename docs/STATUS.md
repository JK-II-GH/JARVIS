# JARVIS — Status & Phasenplan

> Phasen werden der Reihe nach abgearbeitet. Claude Code hakt erledigte Punkte
> ab und ergänzt Erkenntnisse unten.
>
> **Aktuelle Phase: 0**

## Phase 0 — Projektgerüst

- [ ] Node.js (LTS) und Claude Code auf dem Mac installiert
- [ ] Electron-Projekt mit TypeScript aufgesetzt (`package.json`, `tsconfig.json`)
- [ ] Ordnerstruktur gemäß `FOUNDATIONS.md` angelegt
- [ ] App startet, eine leere Pille erscheint als Overlay
- [ ] Git-Repository initialisiert

## Phase 1 — Diktat-Modus (kleinstes lauffähiges MVP)

- [ ] Globaler Hotkey mit Halten + Loslassen (natives Key-Listener-Modul)
- [ ] macOS-Berechtigungen anfragen/prüfen: Mikrofon, Eingabeüberwachung
- [ ] Mikrofonaufnahme, solange die Tasten gehalten werden
- [ ] `STTProvider`-Schnittstelle + Whisper-API-Implementierung
- [ ] Transkript wird an der Cursorposition eingefügt
- [ ] Pille zeigt Status: bereit / hört zu / verarbeitet

## Phase 2 — Text bearbeiten

- [ ] macOS-Berechtigung anfragen/prüfen: Bedienungshilfen
- [ ] Markierten Text auslesen (über Zwischenablage)
- [ ] `AIProvider`-Schnittstelle + Anthropic-Implementierung
- [ ] Sprachbefehl auf markierten Text anwenden, Ergebnis ersetzen
- [ ] Zwischenablage-Inhalt vorher sichern, danach wiederherstellen

## Phase 3 — Gespräch + Vorlesen

- [ ] Gesprächsmodus (freie Unterhaltung)
- [ ] System-TTS zum Vorlesen der Antwort
- [ ] Moduswechsel per Doppeltipp
- [ ] Escape bricht Vorlesen oder laufende Aktion ab

## Phase 4 — Mehrere Anbieter, Einstellungen, Datei-Kontext

- [ ] OpenAI-Implementierung des `AIProvider`
- [ ] Einstellungsfenster: Anbieterauswahl, Hotkey, Position der Pille
- [ ] Datei-Kontext: PDF/Bild auswählen und in den KI-Aufruf laden
- [ ] Einstellungen und Schlüssel sicher im App-Datenverzeichnis speichern

## Phase 5 — Verteilung

- [ ] Build-Konfiguration für macOS (.app / .dmg)
- [ ] GitHub-Releases-Repo + Auto-Update beim Start
- [ ] Release-Skript (Version wählen, bauen, hochladen)
- [ ] Windows-Adapter beginnen (`src/platform/windows`)

## Notizen / Erkenntnisse

> Claude Code trägt hier laufend Learnings ein — Stolpersteine, getroffene
> Entscheidungen, alles was die nächste Sitzung wissen sollte.

- _(noch leer)_
