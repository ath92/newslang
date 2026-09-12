import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fetchArticleHtml, translateSelection } from "../api";
import { extractArticle, type Article } from "../readability";
import { Link } from "../router";
import { sanitizeHtml } from "../sanitize";
import { getSelectionInfo, type SelectionInfo, type SelectionRect } from "../selection";

interface TranslatePopover {
  status: "loading" | "done" | "error";
  phrase: string;
  anchor: SelectionRect;
  translation?: string;
  provider?: string;
  contextCount?: number;
  cached?: boolean;
  error?: string;
}

function toolbarStyle(rect: SelectionRect): CSSProperties {
  const left = Math.min(Math.max(rect.left + rect.width / 2, 48), window.innerWidth - 48);
  return { left, top: Math.max(rect.top - 10, 48) };
}

function popoverStyle(rect: SelectionRect): CSSProperties {
  const width = Math.min(340, window.innerWidth - 24);
  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - width / 2, 12),
    window.innerWidth - width - 12,
  );
  const openUp = rect.bottom + 280 > window.innerHeight;
  return openUp
    ? { left, width, bottom: Math.max(window.innerHeight - rect.top + 10, 12) }
    : { left, width, top: rect.bottom + 10 };
}

export function ArticleView({ url }: { url: string }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [popover, setPopover] = useState<TranslatePopover | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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

  // Track text selections inside the article body. A fresh selection replaces
  // any open translation card, so selecting again just feels responsive.
  useEffect(() => {
    if (!article) return;

    const onSelectionChange = () => {
      const info = getSelectionInfo(contentRef.current);
      setSelection(info);
      if (info) setPopover(null);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [article]);

  useEffect(() => {
    if (!popover) return;
    const close = () => setPopover(null);
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, [popover]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPopover(null);
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const contentHtml = useMemo(
    () => (article?.content ? sanitizeHtml(article.content) : ""),
    [article],
  );

  const handleTranslate = async () => {
    if (!selection) return;
    const { phrase, context, before, after, rect } = selection;

    setSelection(null);
    window.getSelection()?.removeAllRanges();
    setPopover({ status: "loading", phrase, anchor: rect });

    try {
      const { entry, cached } = await translateSelection({
        text: phrase,
        context,
        before,
        after,
        articleUrl: url,
        articleTitle: article?.title,
      });
      setPopover({
        status: "done",
        phrase,
        anchor: rect,
        translation: entry.translation,
        provider: entry.provider,
        contextCount: entry.contexts.length,
        cached,
      });
    } catch (err: unknown) {
      setPopover({
        status: "error",
        phrase,
        anchor: rect,
        error: err instanceof Error ? err.message : "Errore di traduzione",
      });
    }
  };

  return (
    <main className="article">
      <nav className="article__nav">
        <Link to="/" className="back-link">
          ← Tutte le notizie
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
          <p className="article__hint">
            Seleziona una parola o una frase per tradurla e salvarla nel tuo ripasso.
          </p>
          <div
            ref={contentRef}
            className="article__content"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        </article>
      ) : null}

      {selection && !popover ? (
        <button
          type="button"
          className="translate-trigger"
          style={toolbarStyle(selection.rect)}
          onPointerDown={(event) => {
            // Use pointerdown (not click) so touch devices don't collapse the
            // selection before the tap is handled, and suppress the default
            // focus/selection change for mouse users too.
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            void handleTranslate();
          }}
        >
          Traduci
        </button>
      ) : null}

      {popover ? (
        <div
          className="translate-popover"
          style={popoverStyle(popover.anchor)}
          role="dialog"
          aria-label="Traduzione"
        >
          <div className="translate-popover__head">
            <span className="translate-popover__phrase">{popover.phrase}</span>
            {popover.status === "done" ? (
              <span className="translate-popover__saved">
                {popover.cached ? "già in ripasso" : "salvata ✓"}
              </span>
            ) : null}
          </div>

          <div className="translate-popover__body" aria-live="polite">
            {popover.status === "loading" ? <span className="muted">Traduco…</span> : null}
            {popover.status === "error" ? (
              <span className="error-text">{popover.error}</span>
            ) : null}
            {popover.status === "done" ? (
              <p className="translate-popover__translation">{popover.translation}</p>
            ) : null}
          </div>

          {popover.status === "done" && popover.provider === "mock" ? (
            <p className="translate-popover__note">
              Provider non configurato: imposta <code>DEEPL_API_KEY</code> per traduzioni reali.
            </p>
          ) : null}

          {popover.status === "done" && popover.contextCount && popover.contextCount > 1 ? (
            <p className="translate-popover__note">
              {popover.contextCount} contesti salvati per questa voce.
            </p>
          ) : null}

          <div className="translate-popover__actions">
            <Link to="/review" className="button button--ghost">
              Ripasso →
            </Link>
            <button type="button" className="button" onClick={() => setPopover(null)}>
              Chiudi
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
