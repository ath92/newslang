import { useEffect, useMemo, useState } from "react";
import { fetchArticleHtml } from "../api";
import { useArticleMeta } from "../article-meta";
import { QuizPanel } from "../QuizPanel";
import { ReadingProgressBar } from "../ReadingProgressBar";
import { useReadingProgress } from "../reading-progress";
import { extractArticle, type Article } from "../readability";
import { Link } from "../router";
import { sanitizeHtml } from "../sanitize";

export function ArticleView({ url }: { url: string }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const { setMeta } = useArticleMeta();
  const { recordArticle } = useReadingProgress();

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
        if (parsed.readMinutes) {
          void recordArticle({ url, title: parsed.title, minutes: parsed.readMinutes });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore di caricamento");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, recordArticle]);

  // Register this article with the document-wide translator so saved phrases
  // are labelled with the article they came from.
  useEffect(() => {
    setMeta({ url, title: article?.title });
    return () => setMeta({});
  }, [setMeta, url, article?.title]);

  const contentHtml = useMemo(
    () => (article?.content ? sanitizeHtml(article.content) : ""),
    [article],
  );

  return (
    <main className={`article${quizOpen ? " article--quiz-open" : ""}`}>
      <nav className="article__nav">
        <Link to="/" className="back-link">
          ← Tutte le notizie
        </Link>
        <Link to="/settings" className="nav-link" aria-label="Impostazioni">
          ⚙️
        </Link>
        <Link to="/review" className="nav-link">
          Ripasso
        </Link>
      </nav>

      {error ? <div className="state">⚠️ {error}</div> : null}
      {!article && !error ? <div className="state">Caricamento…</div> : null}

      {article ? (
        <article className="article__body">
          <header className="article__header">
            <ReadingProgressBar className="reading-progress--article" />
            {article.siteName ? <span className="article__site">{article.siteName}</span> : null}
            <h1>{article.title}</h1>
            {article.byline || article.readMinutes ? (
              <p className="article__byline">
                {article.byline}
                {article.byline && article.readMinutes ? " · " : null}
                {article.readMinutes ? (
                  <span className="article__read-time">{article.readMinutes} min di lettura</span>
                ) : null}
              </p>
            ) : null}
            {article.excerpt ? <p className="article__excerpt">{article.excerpt}</p> : null}
            {article.textContent ? (
              <button
                type="button"
                className="button button--primary article__quiz-button"
                onClick={() => setQuizOpen(true)}
              >
                🎓 Mettiti alla prova
              </button>
            ) : null}
            {article.preview ? (
              <p className="article__preview-note">
                Anteprima — il contenuto completo è riservato agli abbonati.
              </p>
            ) : null}
          </header>
          <p className="article__hint article__hint--pointer">
            Seleziona una parola o una frase per tradurla e salvarla nel tuo ripasso.
          </p>
          <p className="article__hint article__hint--touch">
            Tocca una parola per tradurla, due volte per la frase, oppure tieni premuto e trascina.
          </p>
          <div className="article__content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
        </article>
      ) : null}

      {quizOpen && article?.textContent ? (
        <QuizPanel
          articleUrl={url}
          title={article.title}
          text={article.textContent}
          onClose={() => setQuizOpen(false)}
        />
      ) : null}
    </main>
  );
}
