import { findPhraseIndex } from "../shared/vocab";

interface HighlightedTextProps {
  /** The full sentence/paragraph to render. */
  text: string;
  /** The saved phrase to emphasize inside `text`. */
  phrase: string;
  /** Text that immediately preceded the phrase, when known. */
  before?: string;
}

/**
 * Render `text` with the saved phrase wrapped in a `<mark>`, so review cards
 * show the word in the sentence it was learned from.
 */
export function HighlightedText({ text, phrase, before }: HighlightedTextProps) {
  const index = findPhraseIndex(text, phrase, before);
  if (index === -1) return <>{text}</>;

  const end = index + phrase.length;
  return (
    <>
      {text.slice(0, index)}
      <mark className="context-highlight">{text.slice(index, end)}</mark>
      {text.slice(end)}
    </>
  );
}
