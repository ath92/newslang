import { useMemo, useState } from "react";
import { ArticleMetaContext, type ArticleMeta } from "./article-meta";
import { SelectionTranslator } from "./SelectionTranslator";
import { ArticleView } from "./views/Article";
import { Home } from "./views/Home";
import { Review } from "./views/Review";
import { Router, useRouter } from "./router";

function RouteSwitch() {
  const { path } = useRouter();

  if (path === "/review") {
    return <Review />;
  }

  const match = path.match(/^\/article\/(.+)$/);
  if (match) {
    let url = match[1];
    try {
      url = decodeURIComponent(url);
    } catch {
      // Keep the raw segment if it is not valid percent-encoding.
    }
    return <ArticleView url={url} />;
  }

  return <Home />;
}

export default function App() {
  const [meta, setMeta] = useState<ArticleMeta>({});
  const value = useMemo(() => ({ meta, setMeta }), [meta]);

  return (
    <Router>
      <ArticleMetaContext.Provider value={value}>
        <RouteSwitch />
        <SelectionTranslator />
      </ArticleMetaContext.Provider>
    </Router>
  );
}
