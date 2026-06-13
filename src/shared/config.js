(function (global) {
  const { DEFAULT_CONFIG, STORAGE_KEYS } = global.PaperTranslatorConstants;

  function normalizeConfig(config) {
    const rawRules = Array.isArray(config && config.urlRules)
      ? config.urlRules.filter(Boolean)
      : DEFAULT_CONFIG.urlRules;
    const apiEndpoint = String((config && config.apiEndpoint) || DEFAULT_CONFIG.apiEndpoint).trim();
    const apiMode =
      apiEndpoint.includes("/chat/completions") && (config && config.apiMode) === "simple"
        ? "openai-compatible"
        : (config && config.apiMode) || DEFAULT_CONFIG.apiMode;

    return {
      ...DEFAULT_CONFIG,
      ...(config || {}),
      apiEndpoint,
      apiMode,
      displayMode: (config && config.displayMode) === "replace" ? "replace" : "bilingual",
      glossary: String((config && config.glossary) || ""),
      urlRules: rawRules.length > 0 ? rawRules : DEFAULT_CONFIG.urlRules
    };
  }

  function loadConfig() {
    return chrome.storage.local
      .get(STORAGE_KEYS.CONFIG)
      .then((items) => normalizeConfig(items[STORAGE_KEYS.CONFIG]));
  }

  function saveConfig(config) {
    return chrome.storage.local.set({
      [STORAGE_KEYS.CONFIG]: normalizeConfig(config)
    });
  }

  function wildcardToRegExp(pattern) {
    const escaped = pattern
      .trim()
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
  }

  function urlMatchesRules(url, rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
      return false;
    }

    return rules.some((rule) => {
      const trimmed = String(rule || "").trim();
      if (!trimmed) return false;

      try {
        return wildcardToRegExp(trimmed).test(url);
      } catch (_error) {
        return false;
      }
    });
  }

  function isPdfUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.pathname.toLowerCase().endsWith(".pdf") || parsed.href.includes("/pdf/");
    } catch (_error) {
      return /\.pdf(?:$|[?#])/i.test(url);
    }
  }

  global.PaperTranslatorConfig = {
    normalizeConfig,
    loadConfig,
    saveConfig,
    urlMatchesRules,
    isPdfUrl
  };
})(globalThis);
