import { Readability } from "@mozilla/readability";
import { estimateReadMinutes } from "../shared/reading";

export interface Article {
  title?: string;
  byline?: string;
  excerpt?: string;
  /** Cleaned HTML of the article body. */
  content?: string;
  /** Plain-text version of the article body. */
  textContent?: string;
  length?: number;
  /** Estimated reading time in whole minutes. */
  readMinutes?: number;
  siteName?: string;
  /** True when only a teaser was available (typically a paywalled article). */
  preview?: boolean;
}

interface JsonLdArticle {
  "@type"?: string | string[];
  headline?: string;
  articleBody?: string;
  description?: string;
  author?: unknown;
  publisher?: { name?: string };
}

const ARTICLE_TYPES = new Set(["NewsArticle", "Article", "ReportageNewsArticle"]);

/** Site footer boilerplate that Readability sometimes mistakes for an article body. */
const BOILERPLATE_RE =
  /(P\.?\s*IVA|I diritti delle immagini|Redazione\s*:|Via Ernesto Lugaro|S\.A\.E\.?\s*S\.P\.A)/i;

function isArticleType(node: JsonLdArticle): boolean {
  const type = node["@type"];
  if (typeof type === "string") return ARTICLE_TYPES.has(type);
  if (Array.isArray(type)) return type.some((t) => ARTICLE_TYPES.has(t));
  return false;
}

function findArticleJsonLd(document: Document): JsonLdArticle | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? "");
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (node && typeof node === "object" && isArticleType(node as JsonLdArticle)) {
          return node as JsonLdArticle;
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return null;
}

function normalizeAuthor(author: unknown): string | undefined {
  if (typeof author === "string") return author || undefined;
  if (Array.isArray(author)) {
    const names = author.map(normalizeAuthor).filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(", ") : undefined;
  }
  if (author && typeof author === "object") {
    const name = (author as { name?: unknown }).name;
    if (typeof name === "string") return name || undefined;
  }
  return undefined;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function articleFromReadability(parsed: NonNullable<ReturnType<Readability["parse"]>>): Article {
  const textContent = parsed.textContent ?? undefined;
  return {
    title: parsed.title ?? undefined,
    byline: parsed.byline ?? undefined,
    excerpt: parsed.excerpt ?? undefined,
    content: parsed.content ?? undefined,
    textContent,
    length: parsed.length ?? undefined,
    readMinutes: estimateReadMinutes(textContent),
    siteName: parsed.siteName ?? undefined,
  };
}

/**
 * Extract the readable article from raw HTML.
 *
 * Uses @mozilla/readability in the browser (where DOMParser provides a full
 * DOM). When Readability only finds site-footer boilerplate — which happens
 * for paywalled pages that hide their body — we fall back to the JSON-LD
 * `articleBody` teaser so the reader still shows something useful.
 */
export function extractArticle(html: string): Article | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const jsonLd = findArticleJsonLd(document);
  const parsed = new Readability(document, { charThreshold: 100 }).parse();

  const readable = parsed ? articleFromReadability(parsed) : null;
  const readableText = readable?.textContent ?? "";
  const readableIsJunk = readableText.length < 600 && BOILERPLATE_RE.test(readableText);

  if (readable && !readableIsJunk) {
    return readable;
  }

  const teaser = jsonLd?.articleBody?.trim();
  if (teaser) {
    const paragraphs = teaser
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    return {
      title: jsonLd?.headline?.trim() || readable?.title,
      byline: normalizeAuthor(jsonLd?.author) ?? readable?.byline,
      excerpt: jsonLd?.description?.trim() || readable?.excerpt,
      content: paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join(""),
      textContent: teaser,
      length: teaser.length,
      readMinutes: estimateReadMinutes(teaser),
      siteName: jsonLd?.publisher?.name?.trim() || readable?.siteName,
      preview: true,
    };
  }

  return readable;
}
