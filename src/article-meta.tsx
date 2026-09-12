import { createContext, useContext } from "react";

/** Metadata about the article currently on screen (empty outside article pages). */
export interface ArticleMeta {
  /** Canonical URL of the article being read. */
  url?: string;
  title?: string;
}

export interface ArticleMetaContextValue {
  meta: ArticleMeta;
  setMeta: (meta: ArticleMeta) => void;
}

export const ArticleMetaContext = createContext<ArticleMetaContextValue>({
  meta: {},
  setMeta: () => {},
});

/** Read (or, from a view, register) the metadata for the current article. */
export function useArticleMeta(): ArticleMetaContextValue {
  return useContext(ArticleMetaContext);
}
