# JARVIS — Foundations

> Diese Datei ist die **Quelle der Wahrheit** für Vision und Architektur von JARVIS.
> Vor jeder größeren Änderung hier abgleichen. Neue Erkenntnisse hier festhalten.

## 1. Was ist JARVIS?

JARVIS ist eine Desktop-KI-Anwendung. Statt ein Programm zu öffnen, etwas zu
kopieren oder einen KI-Anbieter auszuwählen, hält der Nutzer zwei Tasten,
spricht — und JARVIS erledigt den Rest direkt an der Stelle, an der gearbeitet
wird.

Zielsystem: **zuerst macOS, später Windows** — mit einer gemeinsamen Codebasis.

## 2. Kernprinzip

Die App ist *unsichtbar im Weg*. Das eigentliche Produkt ist nicht das
Chatfenster, sondern:

- die **Pille** — ein kleines Overlay, das nur Status und aktuellen Modus zeigt
- die **Zwei-Tasten-Bedienung** — Tasten *halten* = sprechen; *Doppeltipp* = Modus wechseln

Maßstab für jede Designentscheidung: Macht es die Bedienung einfacher und
unauffälliger? Wenn nein — weglassen.

## 3. Modi

- **Diktat** — Gesprochenes wird transkribiert und an der Cursorposition eingefügt.
- **Text bearbeiten** — markierter Text wird gelesen, per Sprachbefehl verändert
  und ersetzt (z. B. „kürze das", „korrigiere die Rechtschreibung", „übersetze
  ins Englische").
- **Gespräch** — freie Unterhaltung mit der KI, die Antwort wird vorgelesen (TTS).
- **Datei-Kontext** — PDF, Screenshot oder Bild wird in den KI-Aufruf geladen,
  danach folgt die Frage.
- **Feedback** *(optional, später)* — Nutzer kann Feature-Wünsche einsprechen.

## 4. Architektur — vier Schichten

1. **Oberfläche** (`src/renderer`) — die Pille und das Einstellungsfenster.
   Zeigt nur an, nimmt Klicks entgegen. Enthält keine Logik.
2. **Kernlogik** (`src/core`) — Modus-Manager, KI-Orchestrierung, STT/TTS-Dienste,
   Datei-Kontext, Einstellungen. Vollständig plattformunabhängig.
3. **Platform-Adapter** (`src/platform/index.ts`) — eine gemeinsame Schnittstelle
   für alles, was sich zwischen Betriebssystemen unterscheidet.
4. **Platform-Implementierung** (`src/platform/macos`, später `.../windows`) —
   erfüllt die Schnittstelle für das jeweilige System.

**Eiserne Regel:** Plattformspezifischer Code lebt AUSSCHLIESSLICH in
`src/platform/`. Kernlogik und Oberfläche kennen nur die Schnittstelle. So kommt
Windows später dazu, ohne dass an Schicht 1–3 eine Zeile geändert wird.

## 5. Technische Entscheidungen

- **Framework: Electron + TypeScript** — eine Codebasis für Mac und Windows,
  großer Werkzeugkasten, alle nötigen Betriebssystem-Zugriffe über native Module
  erreichbar.
- **Cross-Platform** — über die Platform-Adapter-Schicht (siehe Abschnitt 4).
- **Globaler Hotkey mit Halten/Loslassen** — über ein natives Key-Listener-Modul.
  Electrons eingebauter `globalShortcut` erkennt nur den Tastendruck, nicht das
  Halten und Loslassen.
- **Spracherkennung** — Start mit Cloud (Whisper-API) hinter einer austauschbaren
  `STTProvider`-Schnittstelle. Lokale Erkennung (whisper.cpp) lässt sich später
  ohne Änderung der Kernlogik ergänzen.
- **KI-Anbieter** — mehrere, umschaltbar. Eine `AIProvider`-Schnittstelle mit
  Implementierungen für Anthropic und OpenAI; Auswahl in den Einstellungen.
- **TTS** — Start mit der System-Sprachausgabe; Cloud-TTS optional später.
- **MVP-Umfang** — voll: Diktat, Text bearbeiten, Gespräch mit Vorlesen,
  Datei-Kontext. Wird trotzdem phasenweise gebaut (siehe `docs/STATUS.md`).

## 6. macOS-Besonderheiten

- **Berechtigungen** — die App braucht *Mikrofon*, *Eingabeüberwachung* (für die
  globale Tastenerfassung) und *Bedienungshilfen* (zum Lesen/Einfügen von Text).
  Diese erteilt der Nutzer in den Systemeinstellungen. Die App muss fehlende
  Rechte erkennen und freundlich dorthin leiten.
- **Hotkey** — die Kombination „Strg + Windows" gibt es auf dem Mac nicht.
  Standard auf dem Mac: `Cmd + Alt` halten, Doppeltipp zum Moduswechsel.
  Konfigurierbar.
- **Text lesen/einfügen** — pragmatisch über die Zwischenablage: zum Lesen `Cmd+C`
  simulieren, zum Einfügen `Cmd+V`. Den vorherigen Zwischenablage-Inhalt vorher
  sichern und danach wiederherstellen.
- **Verteilung** — für eine warnungsfreie Verteilung an andere ist das Apple
  Developer Program nötig (ca. 99 USD/Jahr) für Signierung und Notarisierung.
  Für eigenes Testen nicht erforderlich.

## 7. Verteilung & Updates

- Releases werden als **GitHub Releases** veröffentlicht (eigenes öffentliches
  Repo nur für die fertigen Versionen).
- **Auto-Update** prüft beim Start gegen GitHub, ob eine neuere Version vorliegt.
- Ein **Release-Skript** automatisiert Bauen und Hochladen.

## 8. Nicht-Ziele

- Kein umfangreiches Chat-Verlaufs-Management wie bei ChatGPT.
- Keine mobile App.
- Kein lokales LLM für die Chat-KI im MVP (nur die Spracherkennung wird
  perspektivisch lokal).
