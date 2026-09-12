import { useEffect, useState } from "react";
import { SOURCES } from "../../shared/contracts";
import type { Headline, SourceId } from "../../shared/contracts";
import { fetchHeadlines } from "../api";
import { Link } from "../router";
import { ReadingProgressBar } from "../ReadingProgressBar";

const STORAGE_KEY = "newslang.source";

function loadSource(): SourceId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && SOURCES.some((source) => source.id === stored)) {
      return stored as SourceId;
    }
  } catch {
    // localStorage may be unavailable; fall back to the default.
  }
  return SOURCES[0].id;
}

function saveSource(source: SourceId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // Ignore write failures (e.g. private browsing).
  }
}

function formatDate(pubDate?: string): string {
  if (!pubDate) return "";
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) return pubDate;
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function Home() {
  const [source, setSource] = useState<SourceId>(loadSource);
  const [headlines, setHeadlines] = useState<Headline[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveSource(source);
    let cancelled = false;
    setHeadlines(null);
    setError(null);

    fetchHeadlines(source)
      .then((items) => {
        if (!cancelled) setHeadlines(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore di caricamento");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <main className="home">
      <header className="home__header">
        <div className="home__topline">
          <h1>Newslang</h1>
          <Link to="/review" className="nav-link">
            Ripasso
          </Link>
        </div>
        <p>Leggi le notizie in italiano</p>

        <ReadingProgressBar />

        <nav className="source-picker" aria-label="Scegli una fonte">
          {SOURCES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`source-picker__button${item.id === source ? " source-picker__button--active" : ""}`}
              aria-pressed={item.id === source}
              onClick={() => setSource(item.id)}
            >
              <span className="source-picker__name">{item.name}</span>
              <span className="source-picker__tagline">{item.tagline}</span>
            </button>
          ))}
        </nav>
      </header>

      {error ? <div className="state">⚠️ {error}</div> : null}
      {!headlines && !error ? <div className="state">Caricamento…</div> : null}
      {headlines?.length === 0 ? <div className="state">Nessun articolo trovato.</div> : null}

      {headlines && headlines.length > 0 ? (
        <ol className="headline-list">
          {headlines.map((headline) => (
            <li key={headline.id}>
              <Link to={`/article/${encodeURIComponent(headline.link)}`} className="headline-card">
                {headline.image ? (
                  <img
                    className="headline-card__image"
                    src={headline.image}
                    alt=""
                    loading="lazy"
                  />
                ) : null}
                <div className="headline-card__body">
                  {headline.category ? (
                    <span className="headline-card__category">{headline.category}</span>
                  ) : null}
                  <h2 className="headline-card__title">{headline.title}</h2>
                  {headline.summary ? (
                    <p className="headline-card__summary">{headline.summary}</p>
                  ) : null}
                  <div className="headline-card__meta">
                    {headline.author ? <span>{headline.author}</span> : null}
                    {headline.pubDate ? (
                      <time dateTime={headline.pubDate}>{formatDate(headline.pubDate)}</time>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </main>
  );
}
