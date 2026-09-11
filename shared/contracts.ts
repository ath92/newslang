/**
 * Shared API contracts between the Cloudflare Worker backend and the React app.
 * Keep this file dependency-free so it can be imported from both projects.
 */

/** The news sources the app supports. */
export const SOURCES = [
  { id: "ansa", name: "ANSA", tagline: "Agenzia di stampa" },
  { id: "rai", name: "Rai News", tagline: "Servizio pubblico" },
] as const;

export type SourceId = (typeof SOURCES)[number]["id"];

export interface NewsSource {
  id: SourceId;
  name: string;
  tagline: string;
}

/** A single headline parsed from a source's RSS feed. */
export interface Headline {
  /** Stable identifier derived from the article URL. */
  id: string;
  title: string;
  /** Absolute URL of the full article. */
  link: string;
  /** Plain-text summary derived from the RSS description. */
  summary: string;
  author?: string;
  /** RFC 2822 date string from the feed. */
  pubDate?: string;
  /** Human-friendly section label (e.g. "Cronaca"). */
  category?: string;
  /** Thumbnail image URL, when the feed provides one. */
  image?: string;
}
