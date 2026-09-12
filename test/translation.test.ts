import { describe, expect, it } from "vitest";
import { buildDeepLRequest, deepLEndpoint } from "../worker/translation";

describe("deepLEndpoint", () => {
  it("uses the free host for sandbox keys", () => {
    expect(deepLEndpoint("abcd-1234:fx")).toBe("https://api-free.deepl.com/v2/translate");
  });

  it("uses the paid host for regular keys", () => {
    expect(deepLEndpoint("abcd-1234")).toBe("https://api.deepl.com/v2/translate");
  });
});

describe("buildDeepLRequest", () => {
  it("sends the phrase, target language and context", () => {
    const body = buildDeepLRequest({
      text: "sfruttare",
      context: "Vogliamo sfruttare questa opportunità.",
      sourceLang: "IT",
      targetLang: "EN-US",
      allowMock: false,
    });

    expect(body).toEqual({
      text: ["sfruttare"],
      target_lang: "EN-US",
      source_lang: "IT",
      context: "Vogliamo sfruttare questa opportunità.",
      preserve_formatting: true,
    });
  });

  it("omits context and source language when absent", () => {
    const body = buildDeepLRequest({
      text: "ciao",
      targetLang: "EN-US",
      allowMock: false,
    });

    expect(body).toEqual({
      text: ["ciao"],
      target_lang: "EN-US",
      preserve_formatting: true,
    });
  });
});
