import { SOURCES } from "../shared/contracts";
import type { SourceId } from "../shared/contracts";
import { fetchHeadlines } from "./rss";

const ARTICLE_USER_AGENT =
  "Mozilla/5.0 (compatible; newslang/0.1; +https://newslang.workers.dev)";

const SOURCE_IDS = new Set<string>(SOURCES.map((source) => source.id));

/** Hosts (and their subdomains) we are allowed to proxy article HTML from. */
const ALLOWED_ARTICLE_HOSTS = ["ansa.it", "rainews.it"];

function isAllowedArticleUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  return ALLOWED_ARTICLE_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

export default {
  async fetch(request, env) {
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
        const headlines = await fetchHeadlines(source as SourceId);
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

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
