import { XMLParser } from "fast-xml-parser";
import type { Headline, SourceId } from "../shared/contracts";

const USER_AGENT = "newslang/0.1 (language-learning app)";

interface SourceConfig {
  rssUrl: string;
  /**
   * Regex applied to each raw `<item>…</item>` block to find a thumbnail URL.
   * Some feeds (e.g. Rai News) put images in `media:content` attributes rather
   * than in the description, so they need a source-specific extractor.
   */
  imageRegex?: RegExp;
}

const SOURCE_CONFIGS: Record<SourceId, SourceConfig> = {
  ansa: {
    rssUrl: "https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml",
  },
  rai: {
    rssUrl: "https://www.rainews.it/rss/tutti",
    imageRegex: /media:content[^>]*\burl=["']([^"']+)["']/i,
  },
};

const parser = new XMLParser({
  // Attributes are handled source-specifically via `imageRegex`.
  ignoreAttributes: true,
  // Turn <dc:creator> into `creator` and <media:content> into `content`.
  removeNSPrefix: true,
  // Keep dates/identifiers as strings instead of guessing numbers.
  parseTagValue: false,
  trimValues: true,
});

interface RssItem {
  title?: string | number;
  link?: string | number;
  description?: string | number;
  creator?: string | number;
  author?: string | number;
  pubDate?: string | number;
  category?: string | string[];
}

function textOf(value: string | number | undefined): string {
  if (typeof value === "number") return String(value);
  return value ?? "";
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Common named HTML entities (fast-xml-parser only decodes the 5 XML ones). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  quot: '"',
  nbsp: " ",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  laquo: "\u00AB",
  raquo: "\u00BB",
  agrave: "à",
  aacute: "á",
  egrave: "è",
  eacute: "é",
  igrave: "ì",
  iacute: "í",
  ograve: "ò",
  oacute: "ó",
  ugrave: "ù",
  uacute: "ú",
};

function fromCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

/**
 * Decode numeric character references (e.g. `&#x27;`) and a small set of
 * named HTML entities that fast-xml-parser leaves untouched.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) =>
      fromCodePoint(Number.parseInt(hex, 16), match),
    )
    .replace(/&#(\d+);/g, (match, dec: string) =>
      fromCodePoint(Number.parseInt(dec, 10), match),
    )
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}

/** Collapse any HTML in an RSS description into a plain-text summary. */
function stripHtml(html: string): string {
  return decodeEntities(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a hash, used to build a stable id for each headline. */
function hashLink(link: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < link.length; i++) {
    hash ^= link.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Parse an RSS document for a given source into headlines.
 * Pure and testable.
 */
export function parseRss(sourceId: SourceId, xml: string): Headline[] {
  const config = SOURCE_CONFIGS[sourceId];
  const headlines: Headline[] = [];

  // Split on <item>…</item> blocks so we can run the source-specific image
  // regex against the raw XML (attribute extraction isn't needed elsewhere).
  const itemPattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml))) {
    const raw = match[1];
    const parsed = parser.parse(`<item>${raw}</item>`) as { item?: RssItem };
    const item = parsed.item;
    if (!item) continue;

    const title = decodeEntities(textOf(item.title)).trim();
    const link = textOf(item.link).trim();
    if (!title || !link) continue;

    const categories = asArray(item.category).map((c) => decodeEntities(c).trim()).filter(Boolean);
    const author = decodeEntities(textOf(item.creator).trim() || textOf(item.author).trim());

    headlines.push({
      id: hashLink(link),
      title,
      link,
      summary: item.description ? stripHtml(textOf(item.description)) : "",
      author: author || undefined,
      pubDate: textOf(item.pubDate).trim() || undefined,
      category: categories[0],
      image: config.imageRegex?.exec(raw)?.[1],
    });
  }

  return headlines;
}

/** Fetch and parse a source's live RSS feed. */
export async function fetchHeadlines(
  sourceId: SourceId,
  fetchFn: typeof fetch = fetch,
): Promise<Headline[]> {
  const config = SOURCE_CONFIGS[sourceId];

  const response = await fetchFn(config.rssUrl, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`${sourceId} RSS request failed with status ${response.status}`);
  }

  return parseRss(sourceId, await response.text());
}
