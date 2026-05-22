# JARVIS — Status & Phasenplan

> Phasen werden der Reihe nach abgearbeitet. Claude Code hakt erledigte Punkte
> ab und ergänzt Erkenntnisse unten.
>
> **Aktuelle Phase: 3**

## Phase 0 — Projektgerüst ✅

- [x] Node.js (LTS) und Claude Code auf dem Mac installiert
- [x] Electron-Projekt mit TypeScript aufgesetzt (`package.json`, `tsconfig.json`)
- [x] Ordnerstruktur gemäß `FOUNDATIONS.md` angelegt
- [x] App startet, eine leere Pille erscheint als Overlay
- [x] Git-Repository initialisiert

## Phase 1 — Diktat-Modus ✅

- [x] Globaler Hotkey mit Halten + Loslassen (natives Key-Listener-Modul)
- [x] macOS-Berechtigungen anfragen/prüfen: Mikrofon, Eingabeüberwachung
- [x] Mikrofonaufnahme, solange die Tasten gehalten werden
- [x] `STTProvider`-Schnittstelle + Whisper-API-Implementierung
- [x] Transkript wird an der Cursorposition eingefügt
- [x] Pille zeigt Status: bereit / hört zu / verarbeitet

## Phase 2 — Text bearbeiten ✅

- [x] macOS-Berechtigung anfragen/prüfen: Bedienungshilfen
- [x] Markierten Text auslesen (über Zwischenablage + Sentinel)
- [x] `AIProvider`-Schnittstelle + Anthropic-Implementierung
- [x] Sprachbefehl auf markierten Text anwenden, Ergebnis ersetzen
- [x] Zwischenablage-Inhalt vorher sichern, danach wiederherstellen

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
- **uiohook-napi**: Verwendet N-API — funktioniert ohne electron-rebuild mit Electron 36. Hotkey: linke oder rechte Cmd-Taste + Option-Taste gleichzeitig halten.
- **Hotkey-Berechtigung**: `uiohook-napi` benötigt macOS Eingabeüberwachung (Systemeinstellungen → Datenschutz → Eingabeüberwachung). Ohne diese Berechtigung feuern die Events nicht, die App läuft aber stabil weiter.
- **API-Schlüssel**: Beim ersten Start ohne Schlüssel zeigt die App einen Dialog mit dem Pfad zu `settings.json` im userData-Verzeichnis (`~/Library/Application Support/jarvis/settings.json`).
- **Audioformat**: Renderer wählt automatisch das beste unterstützte Format (`audio/webm;codecs=opus` bevorzugt). Whisper-API unterstützt WebM nativ.
- **Texteinfügen**: Über Zwischenablage + AppleScript (`keystroke "v" using {command down}`). Vorheriger Clipboard-Inhalt wird nach 150 ms wiederhergestellt.
- **Text lesen**: `readSelectedText()` setzt Sentinel-Wert, simuliert Cmd+C, vergleicht Ergebnis. Bedienungshilfen-Berechtigung für Electron.app nötig (Systemeinstellungen → Bedienungshilfen).
- **Modus-Erkennung**: Automatisch — Text markiert → Bearbeiten-Modus, sonst Diktat.
- **KI-Schlüssel**: `anthropicApiKey` in `~/Library/Application Support/jarvis/settings.json` eintragen (console.anthropic.com/settings/keys).
- **Text-Lesen im Bearbeiten-Modus**: Cmd+C darf NICHT während Cmd+Alt gehalten wird simuliert werden — macOS schickt dann Cmd+Alt+C an die Zielapp, was ignoriert wird. Fix: `readSelectedText()` erst in `onHoldEnd` aufrufen (nach Loslassen der Modifier). Transkription und Text-Lesen laufen parallel via `Promise.all`.
