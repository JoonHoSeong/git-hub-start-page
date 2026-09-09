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

async function detectLanguage(text: string): Promise<string> {
  try {
    const detector = await getDetector();
    if (!detector) return "en";
    const results = await detector.detect(text.slice(0, 200));
    return results[0]?.detectedLanguage ?? "en";
  } catch {
    return "en";
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
  if (source === baseTarget) {
    textCache.set(cacheKey, text);
    return text;
  }

  const translator = await getTranslator(source, target);
  if (!translator) {
    textCache.set(cacheKey, text);
    return text;
  }
  try {
    const out = await translator.translate(text);
    textCache.set(cacheKey, out);
    return out;
  } catch {
    textCache.set(cacheKey, text);
    return text;
  }
}
