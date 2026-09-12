/**
 * Translation provider.
 *
 * DeepL is the default provider: it is the strongest engine for European
 * language pairs (Italian → English), and its `context` parameter lets us pass
 * the surrounding sentence for context-aware translations at no extra cost.
 * Free/sandbox keys end in `:fx` and must hit `api-free.deepl.com`; paid keys
 * use `api.deepl.com`.
 *
 * The provider is deliberately isolated behind `translateText()` so another
 * engine (Azure Translator, Google Cloud Translation, an LLM…) can be dropped
 * in without touching the API routes or the storage layer.
 */

export interface TranslateOptions {
  text: string;
  /** Surrounding sentence/paragraph, sent as DeepL `context` (not billed). */
  context?: string;
  sourceLang?: string;
  targetLang: string;
  apiKey?: string;
  /** When true, fall back to a mock translation if no API key is configured. */
  allowMock: boolean;
}

export interface TranslationResult {
  translation: string;
  detectedSourceLang?: string;
  provider: string;
}

export class TranslationError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "TranslationError";
  }
}

/** DeepL separates free and paid keys by the `:fx` suffix. */
export function deepLEndpoint(apiKey: string): string {
  const host = apiKey.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  return `${host}/v2/translate`;
}

export function buildDeepLRequest(options: TranslateOptions): Record<string, unknown> {
  return {
    text: [options.text],
    target_lang: options.targetLang,
    ...(options.sourceLang ? { source_lang: options.sourceLang } : {}),
    ...(options.context ? { context: options.context } : {}),
    preserve_formatting: true,
  };
}

interface DeepLResponse {
  translations?: Array<{ text?: string; detected_source_language?: string }>;
}

export async function translateText(options: TranslateOptions): Promise<TranslationResult> {
  if (!options.apiKey) {
    if (options.allowMock) {
      return {
        translation: `[mock] ${options.text}`,
        detectedSourceLang: options.sourceLang,
        provider: "mock",
      };
    }
    throw new TranslationError("Translation provider is not configured", 503);
  }

  let response: Response;
  try {
    response = await fetch(deepLEndpoint(options.apiKey), {
      method: "POST",
      headers: {
        authorization: `DeepL-Auth-Key ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildDeepLRequest(options)),
    });
  } catch {
    throw new TranslationError("Failed to reach the translation provider");
  }

  if (!response.ok) {
    if (response.status === 456) {
      throw new TranslationError("Translation quota exceeded for this month", 429);
    }
    if (response.status === 429) {
      throw new TranslationError("Translation provider is rate limiting us, try again", 429);
    }
    if (response.status === 403 || response.status === 401) {
      throw new TranslationError("Translation provider rejected the API key", 502);
    }
    throw new TranslationError(`Translation provider failed (${response.status})`);
  }

  const data = (await response.json()) as DeepLResponse;
  const first = data.translations?.[0];
  if (!first?.text) {
    throw new TranslationError("Translation provider returned an empty response");
  }

  return {
    translation: first.text,
    detectedSourceLang: first.detected_source_language,
    provider: "deepl",
  };
}
