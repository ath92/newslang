import { useEffect, useMemo, useState } from "react";
import { fetchArticleHtml } from "../api";
import { extractArticle, type Article } from "../readability";
import { Link } from "../router";
import { sanitizeHtml } from "../sanitize";

export function ArticleView({ url }: { url: string }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setArticle(null);
    setError(null);

    fetchArticleHtml(url)
      .then((html) => extractArticle(html))
      .then((parsed) => {
        if (cancelled) return;
        if (!parsed?.content) {
          setError("Impossibile estrarre il contenuto dell'articolo.");
          return;
        }
        setArticle(parsed);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore di caricamento");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const contentHtml = useMemo(
    () => (article?.content ? sanitizeHtml(article.content) : ""),
    [article],
  );

  return (
    <main className="article">
      <nav className="article__nav">
        <Link to="/" className="back-link">
          ← Tutte le notizie
        </Link>
      </nav>

      {error ? <div className="state">⚠️ {error}</div> : null}
      {!article && !error ? <div className="state">Caricamento…</div> : null}

      {article ? (
        <article className="article__body">
          <header className="article__header">
            {article.siteName ? <span className="article__site">{article.siteName}</span> : null}
            <h1>{article.title}</h1>
            {article.byline ? <p className="article__byline">{article.byline}</p> : null}
            {article.excerpt ? <p className="article__excerpt">{article.excerpt}</p> : null}
            {article.preview ? (
              <p className="article__preview-note">
                Anteprima — il contenuto completo è riservato agli abbonati.
              </p>
            ) : null}
          </header>
          <div className="article__content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
        </article>
      ) : null}
    </main>
  );
}
