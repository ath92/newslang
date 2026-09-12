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
  return (
    <Router>
      <RouteSwitch />
    </Router>
  );
}
