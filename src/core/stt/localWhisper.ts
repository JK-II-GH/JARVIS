import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import type { LocalSttModel } from "../settings";

/**
 * Übersicht aller unterstützten Modellgrößen — Anzeige + Download-URL.
 * Quelle: HuggingFace ggerganov/whisper.cpp.
 */
export const MODELS: Record<
  LocalSttModel,
  { file: string; sizeMb: number; url: string }
> = {
  tiny: {
    file: "ggml-tiny.bin",
    sizeMb: 75,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
  },
  base: {
    file: "ggml-base.bin",
    sizeMb: 142,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
  },
  small: {
    file: "ggml-small.bin",
    sizeMb: 466,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
  },
};

/** Wo Modelle gespeichert werden: ~/Library/Application Support/jarvis/models/ */
export function getModelsDir(): string {
  return path.join(app.getPath("userData"), "models");
}

export function getModelPath(model: LocalSttModel): string {
  return path.join(getModelsDir(), MODELS[model].file);
}

export function modelExists(model: LocalSttModel): boolean {
  try {
    const s = fs.statSync(getModelPath(model));
    // Sanity-Check: realistische Mindestgröße (Bytes)
    return s.isFile() && s.size > 10 * 1024 * 1024;
  } catch {
    return false;
  }
}

/** Sidecar-Datei mit Download-Metadaten (ETag, Größe). */
interface ModelMeta {
  etag: string;
  size: number;
  downloadedAt: number;
}

function getMetaPath(model: LocalSttModel): string {
  return getModelPath(model) + ".meta.json";
}

function loadMeta(model: LocalSttModel): ModelMeta | null {
  try {
    return JSON.parse(fs.readFileSync(getMetaPath(model), "utf-8"));
  } catch {
    return null;
  }
}

function saveMeta(model: LocalSttModel, meta: ModelMeta): void {
  try {
    fs.writeFileSync(getMetaPath(model), JSON.stringify(meta, null, 2));
  } catch {
    /* nicht kritisch — ETag-Vergleich entfällt dann eben */
  }
}

/** Holt den Remote-ETag per HEAD; null bei Fehler/Offline/fehlendem Header. */
async function fetchRemoteEtag(model: LocalSttModel): Promise<string | null> {
  try {
    const res = await fetch(MODELS[model].url, { method: "HEAD" });
    if (!res.ok) return null;
    const etag = res.headers.get("etag");
    return etag ? etag.replace(/^W\//, "").replace(/"/g, "") : null;
  } catch {
    return null;
  }
}

export type ModelStatus =
  | { state: "missing" }
  | { state: "current" }
  | { state: "update-available" }
  | { state: "unknown" };

/**
 * Prüft, ob das Modell vorhanden ist und ob ein Update verfügbar wäre.
 * "unknown" tritt auf, wenn der Remote-Check fehlschlägt (offline o. Ä.) —
 * dann zeigen wir konservativ keinen Update-Hinweis.
 */
export async function checkModelStatus(model: LocalSttModel): Promise<ModelStatus> {
  if (!modelExists(model)) return { state: "missing" };

  const remoteEtag = await fetchRemoteEtag(model);
  if (!remoteEtag) return { state: "unknown" };

  const meta = loadMeta(model);
  if (!meta) {
    // Altinstallation ohne Meta-Sidecar → "aktuell" annehmen,
    // beim nächsten Download wird Meta nachgezogen
    return { state: "current" };
  }
  return remoteEtag === meta.etag
    ? { state: "current" }
    : { state: "update-available" };
}

/**
 * Sucht das whisper-cli-Binary. Reihenfolge:
 *   1. Standard-Brew-Pfade (arm64 + x64)
 *   2. PATH-Suche via `which`
 * Gibt den absoluten Pfad zurück oder null wenn nichts gefunden wurde.
 */
export function findWhisperBinary(): string | null {
  const candidates = [
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* weiter */ }
  }
  try {
    const r = spawnSync("which", ["whisper-cli"], { encoding: "utf-8" });
    const p = r.stdout.trim();
    if (p && fs.existsSync(p)) return p;
  } catch { /* ignorieren */ }
  return null;
}

/**
 * Lädt das angegebene Modell mit Fortschritts-Callback.
 * Resolved sobald die Datei vollständig geschrieben ist.
 */
export async function downloadModel(
  model: LocalSttModel,
  onProgress: (bytesReceived: number, bytesTotal: number) => void,
): Promise<void> {
  const url = MODELS[model].url;
  const dest = getModelPath(model);
  const tmp = dest + ".part";

  fs.mkdirSync(getModelsDir(), { recursive: true });

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length") || 0);
  const etag  = (res.headers.get("etag") || "").replace(/^W\//, "").replace(/"/g, "");
  let received = 0;

  // Schreiben als Stream
  const fileStream = fs.createWriteStream(tmp);
  const reader = res.body.getReader();
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        await new Promise<void>((resolve, reject) => {
          fileStream.write(value, (err) => (err ? reject(err) : resolve()));
        });
        onProgress(received, total);
      }
    }
  } finally {
    fileStream.end();
    await new Promise<void>((r) => fileStream.once("close", () => r()));
  }

  // Atomisches Umbenennen — verhindert halbe Modelle wenn etwas abbricht
  fs.renameSync(tmp, dest);

  // Meta-Sidecar mit ETag — Basis für spätere Update-Erkennung
  if (etag) saveMeta(model, { etag, size: received, downloadedAt: Date.now() });
}
