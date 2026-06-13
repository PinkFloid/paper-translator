(function (global) {
  // Shown in the popup and options page footers. Put your name here.
  const EXTENSION_AUTHOR = "Liuchy";

  const DEFAULT_CONFIG = {
    enabled: true,
    autoTranslate: true,
    displayMode: "bilingual",
    apiMode: "simple",
    apiEndpoint: "",
    apiKey: "",
    model: "",
    targetLanguage: "zh-CN",
    glossary: "",
    contextEnhanced: true,
    urlRules: [
      "https://arxiv.org/abs/*",
      "https://arxiv.org/html/*",
      "https://openreview.net/forum*",
      "https://aclanthology.org/*"
    ],
    translatePdfLinks: true,
    cacheEnabled: true,
    maxConcurrentRequests: 4
  };

  const MESSAGE_TYPES = {
    GET_CONFIG: "GET_CONFIG",
    SAVE_CONFIG: "SAVE_CONFIG",
    TRANSLATE_BLOCKS: "TRANSLATE_BLOCKS",
    TRANSLATE_PAGE: "TRANSLATE_PAGE",
    ACTIVATE_PAGE: "ACTIVATE_PAGE",
    CLEAR_CACHE: "CLEAR_CACHE"
  };

  const STORAGE_KEYS = {
    CONFIG: "paperTranslator.config",
    CACHE_PREFIX: "paperTranslator.cache."
  };

  global.PaperTranslatorConstants = {
    EXTENSION_AUTHOR,
    DEFAULT_CONFIG,
    MESSAGE_TYPES,
    STORAGE_KEYS
  };
})(globalThis);
