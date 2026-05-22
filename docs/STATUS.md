# JARVIS — Status & Phasenplan

> Phasen werden der Reihe nach abgearbeitet. Claude Code hakt erledigte Punkte
> ab und ergänzt Erkenntnisse unten.
>
> **Aktuelle Phase: 1**

## Phase 0 — Projektgerüst ✅

- [x] Node.js (LTS) und Claude Code auf dem Mac installiert
- [x] Electron-Projekt mit TypeScript aufgesetzt (`package.json`, `tsconfig.json`)
- [x] Ordnerstruktur gemäß `FOUNDATIONS.md` angelegt
- [x] App startet, eine leere Pille erscheint als Overlay
- [x] Git-Repository initialisiert

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

- **Node.js**: Installiert via `brew install node@22`. PATH muss für neue Shells manuell gesetzt werden: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`. Empfehlung: in `~/.zshrc` eintragen.
- **pill.html-Pfad**: `main.js` liegt in `dist/`, `pill.html` in `src/renderer/`. Relativer Pfad `../src/renderer/pill.html` von `__dirname` (=`dist/`) aus ist korrekt.
- **screencapture**: Benötigt Bildschirmaufnahme-Berechtigung — steht beim ersten Start-Test nicht zur Verfügung. Visueller Test muss direkt am Gerät erfolgen.
- **Starten**: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH" && npm run dev` im Projektverzeichnis.
