import { SOURCES, SOURCE_LANG, TARGET_LANG } from "../shared/contracts";
import type { ReviewResult, TranslateRequest, TranslationEntry } from "../shared/contracts";
import {
  normalizePhrase,
  normalizeWhitespace,
  truncateContext,
  MAX_PHRASE_LENGTH,
} from "../shared/vocab";
import { fetchHeadlines } from "./rss";
import { TranslationError, translateText } from "./translation";
import { resolveIdentity } from "./user";

export { TranslationStore } from "./store";

const ARTICLE_USER_AGENT = "Mozilla/5.0 (compatible; newslang/0.1; +https://newslang.workers.dev)";

const SOURCE_IDS = new Set<string>(SOURCES.map((source) => source.id));

/** Hosts (and their subdomains) we are allowed to proxy article HTML from. */
const ALLOWED_ARTICLE_HOSTS = ["ansa.it", "rainews.it"];

const MAX_ENTRIES = 500;

function isAllowedArticleUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  return ALLOWED_ARTICLE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Only trust https article URLs, and only as opaque strings (never fetched). */
function safeArticleUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function storeFor(env: Env, userId: string) {
  const namespace = env.TRANSLATION_STORE;
  if (!namespace) throw new Error("TRANSLATION_STORE binding is not configured");
  return namespace.get(namespace.idFromName(userId));
}

/** Cap how many legacy mock entries we upgrade per request. */
const MOCK_REFRESH_LIMIT = 25;

/**
 * Re-translate an entry that was stored by the deterministic mock translator,
 * now that a real provider key is configured. Returns the updated entry, or
 * null when there is nothing to do (or the provider call fails).
 */
async function refreshMockEntry(
  env: Env,
  store: ReturnType<typeof storeFor>,
  entry: TranslationEntry,
): Promise<TranslationEntry | null> {
  if (entry.provider !== "mock" || !env.DEEPL_API_KEY) return null;

  try {
    const result = await translateText({
      text: entry.phrase,
      context: entry.contexts[0]?.text,
      sourceLang: SOURCE_LANG,
      targetLang: TARGET_LANG,
      apiKey: env.DEEPL_API_KEY,
      allowMock: false,
    });
    return await store.updateTranslation(entry.id, {
      translation: result.translation,
      sourceLang: result.detectedSourceLang ?? SOURCE_LANG,
      provider: result.provider,
    });
  } catch (error) {
    // Keep the mock so a later request can try again instead of failing the list.
    console.warn("Failed to refresh mock translation", entry.id, error);
    return null;
  }
}

/** Upgrade any phrases still carrying a mock translation for this user. */
async function refreshMockEntries(env: Env, store: ReturnType<typeof storeFor>): Promise<void> {
  if (!env.DEEPL_API_KEY) return;
  const mocks = await store.listMock(TARGET_LANG, MOCK_REFRESH_LIMIT);
  for (const entry of mocks) {
    await refreshMockEntry(env, store, entry);
  }
}

async function handleTranslate(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<Partial<TranslateRequest>>(request);
  if (!body || typeof body.text !== "string") {
    return json({ error: "Missing `text` in request body" }, 400);
  }

  const raw = normalizeWhitespace(body.text);
  if (!raw) return json({ error: "`text` is empty" }, 400);
  if (raw.length > MAX_PHRASE_LENGTH) {
    return json({ error: "Selection is too long to translate" }, 413);
  }
  const phrase = normalizePhrase(raw);

  const contextText = typeof body.context === "string" ? truncateContext(body.context) : undefined;
  const context = {
    text: contextText ?? phrase,
    before: typeof body.before === "string" ? body.before : undefined,
    after: typeof body.after === "string" ? body.after : undefined,
    articleUrl: safeArticleUrl(body.articleUrl),
    articleTitle:
      typeof body.articleTitle === "string" ? body.articleTitle.slice(0, 300) : undefined,
  };

  const store = storeFor(env, userId);
  const now = Date.now();

  // Reuse an existing translation (and just record the new context) so repeat
  // lookups never hit the paid API.
  const existing = await store.getByPhrase(phrase, TARGET_LANG);
  if (existing) {
    // A phrase saved before DeepL was configured would otherwise stay mock
    // forever, because we reuse cached translations and never call the API.
    const current = (await refreshMockEntry(env, store, existing)) ?? existing;
    const entry = (await store.addContext(current.id, context, now)) ?? current;
    return json({ entry, cached: true });
  }

  let result;
  try {
    result = await translateText({
      text: phrase,
      context: contextText,
      sourceLang: SOURCE_LANG,
      targetLang: TARGET_LANG,
      apiKey: env.DEEPL_API_KEY,
      allowMock: env.APP_ENV !== "production",
    });
  } catch (error) {
    if (error instanceof TranslationError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }

  const { entry } = await store.saveTranslation({
    phrase,
    translation: result.translation,
    sourceLang: result.detectedSourceLang ?? SOURCE_LANG,
    targetLang: TARGET_LANG,
    provider: result.provider,
    context,
    now,
  });

  return json({ entry, cached: false });
}

async function handleApi(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return Response.json({ ok: true, env: env.APP_ENV ?? "production" });
  }

  if (url.pathname === "/api/headlines") {
    const source = url.searchParams.get("source") ?? "ansa";
    if (!SOURCE_IDS.has(source)) {
      return Response.json({ error: `Unknown source: ${source}` }, { status: 400 });
    }

    try {
      const headlines = await fetchHeadlines(source as (typeof SOURCES)[number]["id"]);
      return Response.json(headlines, {
        headers: {
          "cache-control": "public, max-age=300, stale-while-revalidate=600",
        },
      });
    } catch {
      return Response.json({ error: "Failed to fetch headlines" }, { status: 502 });
    }
  }

  if (url.pathname === "/api/article-html") {
    const target = url.searchParams.get("url");
    if (!target) {
      return Response.json({ error: "Missing `url` query parameter" }, { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      return Response.json({ error: "Invalid `url` query parameter" }, { status: 400 });
    }

    if (!isAllowedArticleUrl(targetUrl)) {
      return Response.json(
        { error: "Only supported news site article URLs are allowed" },
        { status: 400 },
      );
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "user-agent": ARTICLE_USER_AGENT,
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        return Response.json(
          { error: `Article request failed with status ${response.status}` },
          { status: 502 },
        );
      }

      // Return the raw HTML. The client extracts readable content with
      // @mozilla/readability in the browser (avoids any server-side DOM).
      const html = await response.text();
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    } catch {
      return Response.json({ error: "Failed to fetch article" }, { status: 502 });
    }
  }

  if (url.pathname === "/api/translate" && request.method === "POST") {
    return handleTranslate(request, env, userId);
  }

  if (url.pathname === "/api/translations" && request.method === "GET") {
    const query = url.searchParams.get("q") ?? "";
    const store = storeFor(env, userId);
    await refreshMockEntries(env, store);
    const entries = await store.list(query, MAX_ENTRIES);
    return json({ entries });
  }

  const reviewMatch = url.pathname.match(/^\/api\/translations\/(\d+)\/review$/);
  if (reviewMatch && request.method === "POST") {
    const body = await readJson<{ result?: ReviewResult }>(request);
    if (body?.result !== "again" && body?.result !== "known") {
      return json({ error: '`result` must be "again" or "known"' }, 400);
    }
    const entry = await storeFor(env, userId).review(
      Number(reviewMatch[1]),
      body.result,
      Date.now(),
    );
    if (!entry) return json({ error: "Translation not found" }, 404);
    return json({ entry });
  }

  const deleteMatch = url.pathname.match(/^\/api\/translations\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") {
    const removed = await storeFor(env, userId).remove(Number(deleteMatch[1]));
    if (!removed) return json({ error: "Translation not found" }, 404);
    return new Response(null, { status: 204 });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    const { userId, setCookie } = resolveIdentity(request);

    let response: Response;
    try {
      response = await handleApi(request, env, userId);
    } catch (error) {
      console.error("Unhandled API error", error);
      response = json({ error: "Internal error" }, 500);
    }

    if (setCookie) {
      const withCookie = new Response(response.body, response);
      withCookie.headers.append("set-cookie", setCookie);
      response = withCookie;
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
