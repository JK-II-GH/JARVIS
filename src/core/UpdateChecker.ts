/**
 * Update-Checker — fragt die GitHub-Releases-API der konfigurierten
 * Repository ab und meldet, wenn eine neuere Version vorliegt.
 *
 * Bewusst leichtgewichtig: kein Auto-Download, kein Auto-Install
 * (das würde Code-Signierung voraussetzen). Stattdessen liefert die
 * Funktion die Versionsdaten zurück; main.ts entscheidet, wie sie
 * darauf reagiert (Dialog mit Link zum Browser-Download).
 */

export interface UpdateInfo {
  /** Neue Version (ohne führendes "v"). */
  version: string;
  /** Browser-URL der Release-Seite. */
  htmlUrl: string;
  /** Veröffentlichungsdatum als ISO-String. */
  publishedAt: string;
  /** Release-Notes (Markdown). */
  notes: string;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
}

/**
 * Prüft, ob bei `<owner>/<repo>` ein Release neuer als `currentVersion`
 * vorliegt. Gibt null zurück, wenn die App aktuell ist, kein Release
 * gefunden wurde oder die Abfrage fehlschlug.
 */
export async function checkForUpdate(
  owner: string,
  repo: string,
  currentVersion: string,
): Promise<UpdateInfo | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      console.log(`JARVIS: Update-Check → HTTP ${res.status}`);
      return null;
    }
    const release = (await res.json()) as GithubRelease;
    if (release.draft || release.prerelease) return null;

    const latest = release.tag_name.replace(/^v/, "");
    if (!isNewer(latest, currentVersion)) {
      console.log(`JARVIS: Update-Check → aktuell (${currentVersion})`);
      return null;
    }

    console.log(`JARVIS: Update-Check → neue Version ${latest} verfügbar`);
    return {
      version: latest,
      htmlUrl: release.html_url,
      publishedAt: release.published_at,
      notes: release.body || "",
    };
  } catch (err) {
    console.log(`JARVIS: Update-Check fehlgeschlagen: ${err}`);
    return null;
  }
}

/** Semver-Vergleich (nur Major.Minor.Patch, ohne Prereleases). */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return true;
    if (da < db) return false;
  }
  return false;
}
