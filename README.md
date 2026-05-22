# JARVIS

Persönliche Desktop-KI — zwei Tasten halten, sprechen, fertig. Zuerst für
macOS, später Windows. Eine gemeinsame Codebasis.

## Voraussetzungen (einmalig auf dem Mac einrichten)

1. **Node.js (LTS)** — von nodejs.org herunterladen und installieren.
   Im Terminal prüfen mit: `node --version`
2. **Claude Code** — Installationsanleitung unter docs.claude.com. Danach lässt
   sich Claude Code im Projektordner per Befehl `claude` starten.

## Loslegen

1. Diesen Ordner an einen festen Ort auf dem Mac legen, z. B. `~/Projekte/JARVIS`.
2. Ein Terminal in diesem Ordner öffnen und `claude` starten.
3. Claude Code liest automatisch `CLAUDE.md`, `FOUNDATIONS.md` und `docs/STATUS.md`.
4. Claude Code anweisen: „Beginne mit Phase 0 aus STATUS.md."

## Projektstruktur

```
JARVIS/
├─ README.md            ← diese Datei
├─ CLAUDE.md            ← Arbeitshinweise für Claude Code
├─ FOUNDATIONS.md       ← Vision und Architektur (Quelle der Wahrheit)
├─ docs/
│  └─ STATUS.md         ← Phasenplan und aktueller Stand
└─ src/
   ├─ renderer/         ← Oberfläche: die Pille + Einstellungen
   ├─ core/             ← plattformunabhängige Kernlogik
   └─ platform/
      ├─ index.ts       ← gemeinsame Platform-Schnittstelle
      ├─ macos/         ← macOS-Implementierung (jetzt)
      └─ windows/       ← Windows-Implementierung (später)
```

## API-Schlüssel

JARVIS braucht Schlüssel für die KI-Anbieter (Anthropic, OpenAI) und die
Spracherkennung. Diese trägst du später direkt in den Einstellungen der
laufenden App ein — **niemals in den Code oder ins Git-Repository**.

## Dokumente

- `FOUNDATIONS.md` — Vision und Architektur
- `docs/STATUS.md` — Phasenplan, aktueller Stand
- `CLAUDE.md` — Arbeitshinweise für Claude Code
