/**
 * On-device translation using Chrome's built-in Translator API (Chrome/Edge
 * desktop 138+). No network, no API key, private. Falls back gracefully to the
 * original text when unsupported or when a language pair is unavailable.
 *
 * Docs: https://developer.chrome.com/docs/ai/translator-api
 */

// Minimal typings for the built-in AI globals (no @types dependency).
interface AiMonitor {
  addEventListener(type: "downloadprogress", cb: (e: { loaded: number }) => void): void;
}
interface AiTranslator {
  translate(text: string): Promise<string>;
}
interface TranslatorFactory {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: AiMonitor) => void;
  }): Promise<AiTranslator>;
}
interface DetectorResult { detectedLanguage: string; confidence: number }
interface AiDetector { detect(text: string): Promise<DetectorResult[]> }
interface DetectorFactory {
  availability(): Promise<string>;
  create(o?: { monitor?: (m: AiMonitor) => void }): Promise<AiDetector>;
}

function getTranslatorFactory(): TranslatorFactory | null {
  return "Translator" in self ? ((self as unknown as { Translator: TranslatorFactory }).Translator) : null;
}
function getDetectorFactory(): DetectorFactory | null {
  return "LanguageDetector" in self
    ? ((self as unknown as { LanguageDetector: DetectorFactory }).LanguageDetector)
    : null;
}

/** Languages offered in the UI (subset of Chrome-supported, common ones). */
export const TRANSLATE_LANGUAGES: { code: string; label: string }[] = [
  { code: "off", label: "끄기 (원문)" },
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文 (简体)" },
  { code: "zh-Hant", label: "中文 (繁體)" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ru", label: "Русский" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "hi", label: "हिन्दी" },
  { code: "ar", label: "العربية" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Indonesia" },
  { code: "th", label: "ภาษาไทย" },
  { code: "tr", label: "Türkçe" },
];

/** True if the built-in Translator API exists in this browser. */
export function isTranslationSupported(): boolean {
  return getTranslatorFactory() !== null;
}

// Caches so we do not recreate translators or re-translate identical text.
const translatorCache = new Map<string, Promise<AiTranslator | null>>();
const textCache = new Map<string, string>();
let detectorPromise: Promise<AiDetector | null> | null = null;

async function getDetector(): Promise<AiDetector | null> {
  const factory = getDetectorFactory();
  if (!factory) return null;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const avail = await factory.availability();
        if (avail === "unavailable") return null;
        return await factory.create();
      } catch {
        return null;
      }
    })();
  }
  return detectorPromise;
}

/** Rough language guess from character scripts (fallback when detection is
 *  unavailable or low-confidence). Returns a BCP-47 base code or null. */
function guessByScript(text: string): string | null {
  if (/[\u3040-\u30ff]/.test(text)) return "ja"; // Hiragana/Katakana → Japanese
  if (/[\uac00-\ud7a3]/.test(text)) return "ko"; // Hangul
  if (/[\u4e00-\u9fff]/.test(text)) return "zh"; // CJK ideographs (default to Chinese)
  if (/[\u0400-\u04ff]/.test(text)) return "ru"; // Cyrillic
  if (/[\u0600-\u06ff]/.test(text)) return "ar"; // Arabic
  if (/[\u0e00-\u0e7f]/.test(text)) return "th"; // Thai
  return null;
}

async function detectLanguage(text: string): Promise<string> {
  const sample = text.slice(0, 200);
  const scriptGuess = guessByScript(sample);
  try {
    const detector = await getDetector();
    if (!detector) return scriptGuess ?? "en";
    const results = await detector.detect(sample);
    const top = results[0];
    // Trust the detector only when it is reasonably confident; otherwise prefer
    // the script-based guess (e.g. detector unsure on short CJK text).
    if (top && top.confidence >= 0.5) return top.detectedLanguage;
    return scriptGuess ?? top?.detectedLanguage ?? "en";
  } catch {
    return scriptGuess ?? "en";
  }
}

function getTranslator(source: string, target: string): Promise<AiTranslator | null> {
  const key = `${source}->${target}`;
  const cached = translatorCache.get(key);
  if (cached) return cached;
  const factory = getTranslatorFactory();
  if (!factory) return Promise.resolve(null);
  const p = (async () => {
    try {
      const avail = await factory.availability({ sourceLanguage: source, targetLanguage: target });
      if (avail === "unavailable") return null;
      return await factory.create({ sourceLanguage: source, targetLanguage: target });
    } catch {
      return null;
    }
  })();
  translatorCache.set(key, p);
  return p;
}

/**
 * Translate one text to `target`. Returns the original text on any failure or
 * when the source already equals the target. Results are cached per (target,text).
 */
export async function translateText(text: string, target: string): Promise<string> {
  if (!text || target === "off") return text;
  const cacheKey = `${target}:${text}`;
  const hit = textCache.get(cacheKey);
  if (hit !== undefined) return hit;

  const source = await detectLanguage(text);
  const baseTarget = target.split("-")[0];
  const baseSource = source.split("-")[0];
  if (baseSource === baseTarget) {
    textCache.set(cacheKey, text);
    return text;
  }

  // Try a direct translator first.
  let out = await tryTranslate(text, source, target);

  // Fallback: pivot through English when the direct language pair has no pack
  // (e.g. zh->ko). English pairs are broadly available, so source->en->target
  // usually works even when source->target does not.
  if (out === null && baseSource !== "en" && baseTarget !== "en") {
    const viaEn = await tryTranslate(text, source, "en");
    if (viaEn !== null) {
      const final = await tryTranslate(viaEn, "en", target);
      if (final !== null) out = final;
    }
  }

  const result = out ?? text;
  textCache.set(cacheKey, result);
  return result;
}

/** Attempt one translation; returns null if unavailable or on error. */
async function tryTranslate(text: string, source: string, target: string): Promise<string | null> {
  const translator = await getTranslator(source, target);
  if (!translator) return null;
  try {
    return await translator.translate(text);
  } catch {
    return null;
  }
}
