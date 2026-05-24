#!/usr/bin/env bash
#
# JARVIS Release-Skript
#
# Bumpt die Version (npm version), baut macOS-DMGs (arm64 + x64) und
# erstellt ein passendes GitHub-Release mit allen Artefakten.
#
# Nutzung:
#   scripts/release.sh patch            # 0.1.0 → 0.1.1
#   scripts/release.sh minor            # 0.1.0 → 0.2.0
#   scripts/release.sh major            # 0.1.0 → 1.0.0
#   scripts/release.sh patch --draft    # als Draft veröffentlichen
#
# Voraussetzungen:
#   - gh CLI installiert und eingeloggt (gh auth login)
#   - sauberes Arbeitsverzeichnis (alle Änderungen committed)
#   - main-Branch ist aktiv

set -euo pipefail

# ── Argumente ─────────────────────────────────────────────────────────────

BUMP="${1:-}"
DRAFT_FLAG="${2:-}"

if [[ -z "$BUMP" || ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "Nutzung: $0 <patch|minor|major> [--draft]"
  exit 1
fi

# ── Sanity Checks ─────────────────────────────────────────────────────────

if ! command -v gh >/dev/null 2>&1; then
  echo "Fehler: gh CLI nicht installiert. brew install gh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Fehler: gh nicht eingeloggt. gh auth login"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Fehler: Arbeitsverzeichnis nicht sauber. Bitte erst committen."
  git status --short
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "Warnung: Du bist auf Branch '$BRANCH', nicht 'main'."
  read -p "Trotzdem fortfahren? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

# ── Version bumpen ────────────────────────────────────────────────────────

echo "▶ Version bumpen ($BUMP) …"
npm version "$BUMP" --no-git-tag-version >/dev/null
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
echo "  Neue Version: $VERSION (Tag: $TAG)"

# ── Build + Publish ───────────────────────────────────────────────────────

echo "▶ TypeScript kompilieren …"
npm run build

echo "▶ whisper.cpp aktualisieren + bauen …"
bash scripts/build-whisper.sh

echo "▶ DMGs bauen (arm64 + x64) …"
rm -rf release
npx electron-builder --mac

# Multi-Arch-Build hinterlässt eine architekturfremde Binary in
# node_modules/uiohook-napi/build/Release/ — würde den Dev-Start
# danach sprengen. Wegräumen, damit der Prebuild greift.
rm -rf node_modules/uiohook-napi/build

# ── GitHub-Release erstellen ──────────────────────────────────────────────

echo "▶ Änderungen committen + Tag setzen …"
git add package.json package-lock.json
git commit -m "Release $TAG"
git tag "$TAG"

echo "▶ Push zu origin (inkl. Tag) …"
git push --follow-tags

ASSETS=(
  "release/JARVIS-${VERSION}-arm64.dmg"
  "release/JARVIS-${VERSION}.dmg"
)

# Vorhandensein prüfen
for a in "${ASSETS[@]}"; do
  if [[ ! -f "$a" ]]; then
    echo "Fehler: Erwartetes Artefakt fehlt: $a"
    exit 1
  fi
done

echo "▶ GitHub-Release $TAG anlegen …"
RELEASE_ARGS=(--title "JARVIS $VERSION" --generate-notes)
if [[ "$DRAFT_FLAG" == "--draft" ]]; then
  RELEASE_ARGS+=(--draft)
fi

gh release create "$TAG" "${ASSETS[@]}" "${RELEASE_ARGS[@]}"

echo ""
echo "✓ Release $TAG fertig: https://github.com/JK-II-GH/JARVIS/releases/tag/$TAG"
