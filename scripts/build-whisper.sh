#!/usr/bin/env bash
#
# Baut whisper.cpp aus Quellcode und stellt ein Universal-Binary
# (arm64 + x86_64) in build/whisper-bin/whisper-cli bereit. electron-builder
# packt das daraus per extraResources ins App-Bundle.
#
# Vorausgesetzt: cmake, git, Xcode Command Line Tools. Ist whisper.cpp
# bereits geklont, wird nur aktualisiert (kein Rebuild wenn alles aktuell ist).
#
# Nutzung:  scripts/build-whisper.sh

set -euo pipefail

REPO_URL="https://github.com/ggerganov/whisper.cpp.git"
SRC_DIR="build/whisper-src"
OUT_DIR="build/whisper-bin"
OUT_BIN="$OUT_DIR/whisper-cli"

if ! command -v cmake >/dev/null 2>&1; then
  echo "Fehler: cmake nicht gefunden. Bitte zuerst: brew install cmake" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# whisper.cpp klonen oder aktualisieren
if [[ ! -d "$SRC_DIR/.git" ]]; then
  echo "▶ Klone whisper.cpp …"
  git clone --depth=1 "$REPO_URL" "$SRC_DIR"
else
  echo "▶ Aktualisiere whisper.cpp …"
  git -C "$SRC_DIR" fetch --depth=1 origin
  git -C "$SRC_DIR" reset --hard origin/master
fi

# Universal-Build (arm64 + x86_64) mit eingebetteten Metal-Shadern,
# damit das Binary auf jedem Mac läuft, ohne weitere Dateien zu brauchen.
echo "▶ Kompiliere (cmake) …"
cmake -S "$SRC_DIR" -B "$SRC_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 \
  >/dev/null

cmake --build "$SRC_DIR/build" --target whisper-cli --config Release -j

# Ergebnis ins erwartete Ziel kopieren
SRC_BIN="$SRC_DIR/build/bin/whisper-cli"
if [[ ! -f "$SRC_BIN" ]]; then
  echo "Fehler: whisper-cli nicht unter $SRC_BIN gebaut." >&2
  exit 1
fi
cp "$SRC_BIN" "$OUT_BIN"
chmod +x "$OUT_BIN"

# Sicherstellen, dass es wirklich universal ist
echo ""
echo "▶ Ergebnis:"
file "$OUT_BIN"
echo "Größe: $(du -h "$OUT_BIN" | cut -f1)"
echo ""
echo "✓ Binary fertig unter $OUT_BIN"
