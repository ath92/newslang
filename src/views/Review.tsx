import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReviewResult, TranslationEntry } from "../../shared/contracts";
import { deleteTranslation, fetchTranslations, reviewTranslation } from "../api";
import { HighlightedText } from "../HighlightedText";
import { Link } from "../router";
import { isDue, MAX_BOX } from "../../shared/vocab";

type Mode = "list" | "review";

/** Don't let a single review session run away. */
const REVIEW_LIMIT = 30;

function formatDate(timestamp?: number): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

function BoxMeter({ box }: { box: number }) {
  const filled = "●".repeat(Math.min(box, MAX_BOX));
  const empty = "○".repeat(Math.max(MAX_BOX - box, 0));
  return (
    <span
      className="entry-card__box"
      title={`Livello ${box} di ${MAX_BOX}`}
      aria-label={`Livello ${box} di ${MAX_BOX}`}
    >
      {filled}
      {empty}
    </span>
  );
}

export function Review() {
  const [entries, setEntries] = useState<TranslationEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [query, setQuery] = useState("");

  const [queue, setQueue] = useState<TranslationEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answering, setAnswering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTranslations()
      .then((items) => {
        if (!cancelled) setEntries(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Errore di caricamento");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const due = useMemo(() => {
    const now = Date.now();
    return (entries ?? []).filter((entry) => isDue(entry, now));
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries ?? [];
    return (entries ?? []).filter(
      (entry) =>
        entry.phrase.toLowerCase().includes(needle) ||
        entry.translation.toLowerCase().includes(needle) ||
        entry.contexts.some((context) => context.text.toLowerCase().includes(needle)),
    );
  }, [entries, query]);

  const startReview = useCallback((pool: TranslationEntry[]) => {
    const ordered = [...pool]
      .sort((a, b) => a.box - b.box || a.dueAt - b.dueAt)
      .slice(0, REVIEW_LIMIT);
    setQueue(ordered);
    setIndex(0);
    setRevealed(false);
    setMode("review");
  }, []);

  const answer = useCallback(
    async (result: ReviewResult) => {
      if (!queue) return;
      const current = queue[index];
      if (!current || answering) return;

      setAnswering(true);
      try {
        const updated = await reviewTranslation(current.id, result);
        setEntries(
          (prev) => prev?.map((entry) => (entry.id === updated.id ? updated : entry)) ?? prev,
        );
        setIndex((value) => value + 1);
        setRevealed(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Errore di salvataggio");
      } finally {
        setAnswering(false);
      }
    },
    [answering, index, queue],
  );

  useEffect(() => {
    if (mode !== "review") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMode("list");
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        else void answer("known");
        return;
      }
      if (!revealed) return;
      if (event.key === "1" || event.key === "ArrowLeft") {
        event.preventDefault();
        void answer("again");
      }
      if (event.key === "2" || event.key === "ArrowRight") {
        event.preventDefault();
        void answer("known");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answer, mode, revealed]);

  const handleDelete = async (entry: TranslationEntry) => {
    if (!window.confirm(`Eliminare «${entry.phrase}» dal ripasso?`)) return;
    try {
      await deleteTranslation(entry.id);
      setEntries((prev) => prev?.filter((item) => item.id !== entry.id) ?? prev);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore di eliminazione");
    }
  };

  const done = queue !== null && index >= queue.length;

  return (
    <main className="review">
      <nav className="article__nav">
        <Link to="/" className="back-link">
          ← Tutte le notizie
        </Link>
        <Link to="/settings" className="nav-link" aria-label="Impostazioni">
          ⚙️
        </Link>
      </nav>

      <header className="review__header">
        <h1>Ripasso</h1>
        <p className="review__stats">
          {(entries ?? []).length} voci salvate · {due.length} in scadenza
        </p>
      </header>

      {error ? <div className="state">⚠️ {error}</div> : null}
      {!entries && !error ? <div className="state">Caricamento…</div> : null}

      {entries && entries.length === 0 ? (
        <div className="state">
          Nessuna traduzione salvata. Apri un articolo e seleziona una parola per iniziare.
        </div>
      ) : null}

      {entries && entries.length > 0 ? (
        <>
          <div className="review__toolbar">
            <div className="review__modes" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "list"}
                className={`toggle${mode === "list" ? " toggle--active" : ""}`}
                onClick={() => setMode("list")}
              >
                Elenco
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "review"}
                className={`toggle${mode === "review" ? " toggle--active" : ""}`}
                onClick={() => startReview(due.length > 0 ? due : entries)}
              >
                Ripasso
              </button>
            </div>
            <button
              type="button"
              className="button button--primary"
              onClick={() => startReview(due.length > 0 ? due : entries)}
            >
              {due.length > 0 ? `Ripassa ${due.length} in scadenza` : "Ripassa tutto"}
            </button>
          </div>

          {mode === "list" ? (
            <>
              <input
                type="search"
                className="review__search"
                placeholder="Cerca in parole, traduzioni e contesti…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Cerca nelle traduzioni salvate"
              />

              {filtered.length === 0 ? (
                <div className="state">Nessun risultato.</div>
              ) : (
                <ul className="entry-list">
                  {filtered.map((entry) => (
                    <li key={entry.id} className="entry-card">
                      <div className="entry-card__head">
                        <strong className="entry-card__phrase">{entry.phrase}</strong>
                        <BoxMeter box={entry.box} />
                      </div>
                      <p className="entry-card__translation">{entry.translation}</p>

                      {entry.contexts.length > 0 ? (
                        <ul className="entry-card__contexts">
                          {entry.contexts.slice(0, 3).map((context) => (
                            <li key={context.id} className="entry-card__context">
                              <span className="entry-card__context-text">
                                “
                                <HighlightedText
                                  text={context.text}
                                  phrase={entry.phrase}
                                  before={context.before}
                                />
                                ”
                              </span>
                              {context.articleUrl ? (
                                <a
                                  className="entry-card__source"
                                  href={context.articleUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {context.articleTitle ?? "articolo"} ↗
                                </a>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <div className="entry-card__meta">
                        <span>{entry.reviewCount} ripassi</span>
                        {entry.lastReviewedAt ? (
                          <span>ultimo {formatDate(entry.lastReviewedAt)}</span>
                        ) : (
                          <span>mai ripassata</span>
                        )}
                        {entry.provider ? (
                          <span className="entry-card__provider">{entry.provider}</span>
                        ) : null}
                        <button
                          type="button"
                          className="entry-card__delete"
                          onClick={() => void handleDelete(entry)}
                        >
                          Elimina
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <section className="review-session">
              {!queue || queue.length === 0 ? (
                <div className="state">Nessuna voce da ripassare.</div>
              ) : done ? (
                <div className="review-card review-card--done">
                  <p className="review-card__done-title">🎉 Sessione completata</p>
                  <p className="muted">{queue.length} voci ripassate.</p>
                  <div className="review-card__actions">
                    <button
                      type="button"
                      className="button"
                      onClick={() => startReview(due.length > 0 ? due : entries)}
                    >
                      Ancora
                    </button>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => setMode("list")}
                    >
                      Torna all'elenco
                    </button>
                  </div>
                </div>
              ) : (
                <div className="review-card">
                  <div className="review-card__progress">
                    {index + 1} / {queue.length}
                  </div>
                  <p className="review-card__phrase">{queue[index].phrase}</p>
                  {queue[index].contexts[0] ? (
                    <p className="review-card__context">
                      “
                      <HighlightedText
                        text={queue[index].contexts[0].text}
                        phrase={queue[index].phrase}
                        before={queue[index].contexts[0].before}
                      />
                      ”
                    </p>
                  ) : null}

                  {revealed ? (
                    <>
                      <p className="review-card__translation">{queue[index].translation}</p>
                      <div className="review-card__actions">
                        <button
                          type="button"
                          className="button button--danger"
                          onClick={() => void answer("again")}
                          disabled={answering}
                        >
                          Di nuovo <kbd>1</kbd>
                        </button>
                        <button
                          type="button"
                          className="button button--primary"
                          onClick={() => void answer("known")}
                          disabled={answering}
                        >
                          Lo sapevo <kbd>2</kbd>
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="review-card__actions">
                      <button
                        type="button"
                        className="button button--primary"
                        onClick={() => setRevealed(true)}
                      >
                        Mostra la traduzione <kbd>Spazio</kbd>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}
