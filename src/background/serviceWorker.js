importScripts(
  "../shared/constants.js",
  "../shared/config.js",
  "cache.js",
  "translatorClient.js"
);

(function () {
  const { MESSAGE_TYPES } = PaperTranslatorConstants;
  const { loadConfig } = PaperTranslatorConfig;
  const { getCachedTranslation, setCachedTranslation, clearCache } = PaperTranslatorCache;
  const { translateText } = PaperTranslatorClient;

  async function translateOne(config, block, context) {
    try {
      if (config.cacheEnabled) {
        const cached = await getCachedTranslation(config, block.text, context);
        if (cached && cached.translatedText) {
          return {
            id: block.id,
            translatedText: cached.translatedText,
            cached: true
          };
        }
      }

      const translatedText = await translateText(config, block.text, context, block.contextBefore || "");

      if (config.cacheEnabled) {
        await setCachedTranslation(config, block.text, translatedText, context);
      }

      return {
        id: block.id,
        translatedText,
        cached: false
      };
    } catch (error) {
      return {
        id: block.id,
        translatedText: "",
        error: error && error.message ? error.message : String(error)
      };
    }
  }

  async function mapWithConcurrency(items, limit, worker) {
    const results = [];
    let cursor = 0;

    async function runNext() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }

    const workers = Array.from({ length: Math.max(1, limit) }, runNext);
    await Promise.all(workers);
    return results;
  }

  async function handleTranslate(payload) {
    const config = await loadConfig();
    const blocks = Array.isArray(payload && payload.blocks) ? payload.blocks : [];

    if (!config.enabled) {
      return {
        results: blocks.map((block) => ({
          id: block.id,
          translatedText: "",
          error: "Translator is disabled"
        }))
      };
    }

    const context = (payload && payload.context) || null;
    const limit = Math.min(Math.max(Number(config.maxConcurrentRequests) || 3, 1), 8);
    const results = await mapWithConcurrency(blocks, limit, (block) => translateOne(config, block, context));
    return { results };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === MESSAGE_TYPES.TRANSLATE_BLOCKS) {
      handleTranslate(message.payload)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            error: error && error.message ? error.message : String(error)
          });
        });
      return true;
    }

    if (message.type === MESSAGE_TYPES.GET_CONFIG) {
      loadConfig()
        .then((config) => sendResponse({ config }))
        .catch((error) => {
          sendResponse({
            error: error && error.message ? error.message : String(error)
          });
        });
      return true;
    }

    if (message.type === MESSAGE_TYPES.CLEAR_CACHE) {
      clearCache()
        .then((count) => sendResponse({ count }))
        .catch((error) => {
          sendResponse({
            error: error && error.message ? error.message : String(error)
          });
        });
      return true;
    }

    return false;
  });
})();
