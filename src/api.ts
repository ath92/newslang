import type { Headline, SourceId } from "../shared/contracts";

export async function fetchHeadlines(source: SourceId): Promise<Headline[]> {
  const response = await fetch(`/api/headlines?source=${encodeURIComponent(source)}`);
  if (!response.ok) {
    throw new Error(`Impossibile caricare le notizie (${response.status})`);
  }
  return response.json();
}

export async function fetchArticleHtml(url: string): Promise<string> {
  const response = await fetch(`/api/article-html?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(`Impossibile caricare l'articolo (${response.status})`);
  }
  return response.text();
}
