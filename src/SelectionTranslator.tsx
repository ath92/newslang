import { useEffect, useState, type CSSProperties } from "react";
import { translateSelection } from "./api";
import { useArticleMeta } from "./article-meta";
import { Link, useRouter } from "./router";
import { getSelectionInfo, useTextSelection } from "./selection";
import type { SelectionInfo, SelectionRect } from "./selection";

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

/**
 * Document-wide translation layer.
 *
 * On touch devices a custom selection engine (tap = word, double-tap =
 * sentence, press-and-hold-drag = phrase) replaces the native one, so no OS
 * edit toolbar appears. Everywhere else the browser's own selection is used.
 * Either way the translator's popover is marked `data-translate-ignore`, so its
 * text can be selected and copied without triggering another translation.
 */
export function SelectionTranslator() {
  const { meta } = useArticleMeta();
  const { path } = useRouter();
  const custom = useTextSelection();
  const [nativeSelection, setNativeSelection] = useState<SelectionInfo | null>(null);
  const [popover, setPopover] = useState<TranslatePopover | null>(null);

  const selection = custom.active ? custom.selection : nativeSelection;
  const clearCustom = custom.clear;

  // Native selection only matters when the custom engine is not running.
  useEffect(() => {
    if (custom.active) return;
    const onSelectionChange = () => {
      const info = getSelectionInfo();
      setNativeSelection(info);
      if (info) setPopover(null);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [custom.active]);

  // A fresh custom selection replaces any open translation card.
  useEffect(() => {
    if (custom.selection) setPopover(null);
  }, [custom.selection]);

  // Navigating away should not leave a stale card floating over the new view.
  useEffect(() => {
    setNativeSelection(null);
    clearCustom();
    setPopover(null);
  }, [path, clearCustom]);

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
        setNativeSelection(null);
        clearCustom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearCustom]);

  const handleTranslate = async () => {
    if (!selection) return;
    const { phrase, context, before, after, rect } = selection;

    if (custom.active) {
      clearCustom();
    } else {
      setNativeSelection(null);
      window.getSelection()?.removeAllRanges();
    }
    setPopover({ status: "loading", phrase, anchor: rect });

    try {
      const { entry, cached } = await translateSelection({
        text: phrase,
        context,
        before,
        after,
        articleUrl: meta.url,
        articleTitle: meta.title,
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
    <>
      {selection && !popover ? (
        <button
          type="button"
          className="translate-trigger"
          style={toolbarStyle(selection.rect)}
          data-translate-ignore
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

      {custom.active && custom.selection && custom.handles && !popover ? (
        <>
          <span
            className="translate-handle translate-handle--start"
            data-translate-handle=""
            aria-hidden="true"
            style={{ left: custom.handles.start.x, top: custom.handles.start.y }}
            onPointerDown={(event) => custom.onHandlePointerDown("start", event)}
          />
          <span
            className="translate-handle translate-handle--end"
            data-translate-handle=""
            aria-hidden="true"
            style={{ left: custom.handles.end.x, top: custom.handles.end.y }}
            onPointerDown={(event) => custom.onHandlePointerDown("end", event)}
          />
        </>
      ) : null}

      {popover ? (
        <div
          className="translate-popover"
          style={popoverStyle(popover.anchor)}
          role="dialog"
          aria-label="Traduzione"
          data-translate-ignore
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
    </>
  );
}
