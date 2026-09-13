import { useMemo, useState } from "react";
import { ArticleMetaContext, type ArticleMeta } from "./article-meta";
import { InstallPrompt } from "./InstallPrompt";
import { NotificationPrompt } from "./NotificationPrompt";
import { ReadingProgressProvider } from "./reading-progress";
import { SelectionTranslator } from "./SelectionTranslator";
import { SettingsProvider } from "./settings";
import { ArticleView } from "./views/Article";
import { Home } from "./views/Home";
import { Review } from "./views/Review";
import { Settings } from "./views/Settings";
import { Router, useRouter } from "./router";

function RouteSwitch() {
  const { path } = useRouter();

  if (path === "/review") {
    return <Review />;
  }

  if (path === "/settings") {
    return <Settings />;
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
        <SettingsProvider>
          <ReadingProgressProvider>
            <RouteSwitch />
            <SelectionTranslator />
            <div className="prompt-stack">
              <InstallPrompt />
              <NotificationPrompt />
            </div>
          </ReadingProgressProvider>
        </SettingsProvider>
      </ArticleMetaContext.Provider>
    </Router>
  );
}
