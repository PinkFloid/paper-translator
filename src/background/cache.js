(function (global) {
  const { STORAGE_KEYS } = global.PaperTranslatorConstants;

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function cacheKey(config, text, context) {
    // The document title and user glossary change the expected output, so they
    // scope the cache; auto-extracted terms are excluded because they can vary
    // slightly between scans of the same page.
    const scope = [
      config.apiMode,
      config.apiEndpoint,
      config.model,
      config.targetLanguage,
      config.glossary || "",
      (context && context.title) || ""
    ].join("|");
    return `${STORAGE_KEYS.CACHE_PREFIX}${hashText(`${scope}|${text}`)}`;
  }

  async function getCachedTranslation(config, text, context) {
    const key = cacheKey(config, text, context);
    const items = await chrome.storage.local.get(key);
    return items[key] || "";
  }

  async function setCachedTranslation(config, text, translatedText, context) {
    const key = cacheKey(config, text, context);
    await chrome.storage.local.set({
      [key]: {
        translatedText,
        createdAt: Date.now()
      }
    });
  }

  async function clearCache() {
    const items = await chrome.storage.local.get(null);
    const keys = Object.keys(items).filter((key) => key.startsWith(STORAGE_KEYS.CACHE_PREFIX));
    if (keys.length > 0) {
      await chrome.storage.local.remove(keys);
    }
    return keys.length;
  }

  global.PaperTranslatorCache = {
    getCachedTranslation,
    setCachedTranslation,
    clearCache
  };
})(globalThis);
