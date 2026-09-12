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

/** Language the news is written in, and the language the reader learns. */
export const SOURCE_LANG = "IT";
/** Language translations are delivered in (DeepL-style locale code). */
export const TARGET_LANG = "EN-US";

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

/** One place a phrase was seen, with the sentence that surrounded it. */
export interface TranslationContext {
  id: number;
  /** The paragraph/sentence the phrase appeared in. */
  text: string;
  /** Text immediately before the selection inside the context. */
  before?: string;
  /** Text immediately after the selection inside the context. */
  after?: string;
  articleUrl?: string;
  articleTitle?: string;
  createdAt: number;
}

/** A saved phrase plus its translation, reviewer stats and example contexts. */
export interface TranslationEntry {
  id: number;
  phrase: string;
  translation: string;
  sourceLang?: string;
  targetLang: string;
  provider?: string;
  createdAt: number;
  updatedAt: number;
  reviewCount: number;
  correctCount: number;
  lastReviewedAt?: number;
  /** Leitner box: 0 = new/struggling, MAX_BOX = well known. */
  box: number;
  /** Unix ms timestamp of the next review. */
  dueAt: number;
  contexts: TranslationContext[];
}

/** Body of `POST /api/translate`. */
export interface TranslateRequest {
  text: string;
  /** Surrounding paragraph, used to disambiguate the translation. */
  context?: string;
  before?: string;
  after?: string;
  articleUrl?: string;
  articleTitle?: string;
}

/** Response of `POST /api/translate`. */
export interface TranslateResponse {
  entry: TranslationEntry;
  /** True when the phrase was already in the user's vocabulary. */
  cached: boolean;
}

/** How the reader answered a review card. */
export type ReviewResult = "again" | "known";
