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

/**
 * Semver-Vergleich für Versionen wie 1.2.3 oder 1.2.3-beta.1. Prerelease-
 * Suffixe (alles nach dem ersten "-") gelten als KLEINER als die nackte
 * Version, also gilt 1.2.3 > 1.2.3-beta.1. Build-Metadaten (nach "+")
 * werden ignoriert. Reicht für unsere GitHub-Release-Tags.
 */
function isNewer(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.numbers[i] > pb.numbers[i]) return true;
    if (pa.numbers[i] < pb.numbers[i]) return false;
  }
  // Major.Minor.Patch sind gleich → Prereleases zählen schlechter
  if (pa.prerelease === "" && pb.prerelease !== "") return true;
  if (pa.prerelease !== "" && pb.prerelease === "") return false;
  return pa.prerelease > pb.prerelease;
}

function parseSemver(v: string): { numbers: number[]; prerelease: string } {
  // Build-Metadaten abschneiden
  const withoutBuild = v.split("+")[0];
  const [core, ...preParts] = withoutBuild.split("-");
  const numbers = core.split(".").map((n) => parseInt(n, 10) || 0);
  while (numbers.length < 3) numbers.push(0);
  return { numbers: numbers.slice(0, 3), prerelease: preParts.join("-") };
}
