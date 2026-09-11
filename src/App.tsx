import { ArticleView } from "./views/Article";
import { Home } from "./views/Home";
import { Router, useRouter } from "./router";

function RouteSwitch() {
  const { path } = useRouter();

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
