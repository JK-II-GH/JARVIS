/**
 * Lädt eine Webseite, parst das HTML und extrahiert den redaktionellen
 * Hauptinhalt mit Mozillas Readability-Algorithmus (gleiche Engine wie
 * Firefox Reader View). Navigation, Werbung, Footer, Sidebars und sonstiges
 * Boilerplate fallen raus.
 *
 * Liefert null, wenn die Seite nicht erreichbar ist, das HTML kein
 * sinnvolles Ergebnis liefert (z. B. JavaScript-App ohne SSR), oder der
 * extrahierte Text zu kurz ist (< 200 Zeichen). Der Caller fällt dann
 * üblicherweise auf einen Fenster-Screenshot zurück.
 */

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ExtractedArticle {
  url: string;
  title: string;
  text: string;
}

/** Mindestlänge des Plain-Text-Outputs, damit wir nicht leere Seiten weiterreichen. */
const MIN_TEXT_LENGTH = 200;

/** Harte Timeout-Grenze für den fetch, damit JARVIS nicht hängt. */
const FETCH_TIMEOUT_MS = 8000;

export async function extractArticle(url: string): Promise<ExtractedArticle | null> {
  // AbortController gegen blockierende Netzwerke
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Realistischer UA — manche Sites blocken sonst sofort
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_0) AppleWebKit/605.1.15 " +
          "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de,en;q=0.7",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      console.log(`JARVIS: Artikel-Extraktion HTTP ${res.status} für ${url}`);
      return null;
    }
    const html = await res.text();

    // JSDOM braucht eine Basis-URL für relative Links + Bilder
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      console.log(`JARVIS: Readability fand keinen Artikel auf ${url}`);
      return null;
    }
    const text = (article.textContent ?? "").trim();
    if (text.length < MIN_TEXT_LENGTH) {
      console.log(
        `JARVIS: Artikel-Text zu kurz (${text.length} Zeichen) — vermutlich JS-App oder Paywall`,
      );
      return null;
    }

    return {
      url,
      title: (article.title ?? "").trim(),
      text,
    };
  } catch (err) {
    console.log(`JARVIS: Artikel-Extraktion fehlgeschlagen: ${err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
