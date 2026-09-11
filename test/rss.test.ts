import { describe, expect, it } from "vitest";
import { parseRss } from "../worker/rss";

const ANSA_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ANSA.it</title>
    <link>https://www.ansa.it</link>
    <item>
      <title><![CDATA[Il gas parte in calo (-1,7%) a 80,6 euro al Megawattora]]></title>
      <description><![CDATA[Sul mercato di Amsterdam di riferimento per l'Europa]]></description>
      <link>https://www.ansa.it/sito/notizie/topnews/2026/09/11/il-gas_123.html</link>
      <pubDate>Fri, 11 Sep 2026 08:42:43 +0200</pubDate>
      <guid>https://www.ansa.it/sito/notizie/topnews/2026/09/11/il-gas_123.html</guid>
    </item>
    <item>
      <title>Solo titolo</title>
    </item>
    <item>
      <link>https://www.ansa.it/sito/notizie/topnews/2026/09/11/senza-titolo.html</link>
    </item>
  </channel>
</rss>`;

const RAI_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>RaiNews</title>
    <link>https://www.rainews.it</link>
    <item>
      <guid>https://www.rainews.it/articoli/2026/09/incidente.html</guid>
      <title>Viareggio, travolta da un&#x27;auto pirata mentre è in bici: muore una donna</title>
      <link>https://www.rainews.it/articoli/2026/09/incidente.html</link>
      <media:content medium="image" url="https://www.rainews.it/dl/img/2025/9/08/immagine.PNG">
        <media:thumbnail url="https://www.rainews.it/dl/img/2025/9/08/immagine.PNG"/>
        <media:title>Incidente stradale</media:title>
      </media:content>
      <description>L&#x27;incidente nella notte sul vecchio cavalcavia di Viareggio.</description>
      <media:credit role="producer" scheme="urn:ebu">RaiNews</media:credit>
      <pubDate>Fri, 11 Sep 2026 06:39:00 GMT</pubDate>
      <category>Cronaca</category>
      <category domain="/tags/what">Incidente stradale</category>
    </item>
  </channel>
</rss>`;

describe("parseRss", () => {
  it("parses ANSA items into headlines", () => {
    const headlines = parseRss("ansa", ANSA_RSS);
    expect(headlines).toHaveLength(1);

    const [first] = headlines;
    expect(first.title).toBe("Il gas parte in calo (-1,7%) a 80,6 euro al Megawattora");
    expect(first.link).toBe(
      "https://www.ansa.it/sito/notizie/topnews/2026/09/11/il-gas_123.html",
    );
    expect(first.summary).toBe("Sul mercato di Amsterdam di riferimento per l'Europa");
    expect(first.pubDate).toBe("Fri, 11 Sep 2026 08:42:43 +0200");
    expect(first.image).toBeUndefined();
    expect(first.category).toBeUndefined();
  });

  it("parses Rai News items, decoding entities and extracting the image", () => {
    const headlines = parseRss("rai", RAI_RSS);
    expect(headlines).toHaveLength(1);

    const [first] = headlines;
    expect(first.title).toContain("travolta da un'auto pirata");
    expect(first.summary).toBe("L'incidente nella notte sul vecchio cavalcavia di Viareggio.");
    expect(first.category).toBe("Cronaca");
    expect(first.image).toBe("https://www.rainews.it/dl/img/2025/9/08/immagine.PNG");
  });

  it("skips items without a title or link", () => {
    const headlines = parseRss("ansa", ANSA_RSS);
    expect(headlines.map((h) => h.title)).toEqual([
      "Il gas parte in calo (-1,7%) a 80,6 euro al Megawattora",
    ]);
  });

  it("returns a stable id per link", () => {
    const [a] = parseRss("ansa", ANSA_RSS);
    const [b] = parseRss("ansa", ANSA_RSS);
    expect(a.id).toBeTruthy();
    expect(a.id).toBe(b.id);
  });
});
