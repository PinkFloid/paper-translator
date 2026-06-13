(function () {
  const { DEFAULT_CONFIG, EXTENSION_AUTHOR } = PaperTranslatorConstants;
  document.getElementById("credit").textContent = `Made by ${EXTENSION_AUTHOR}`;
  const { loadConfig, saveConfig, normalizeConfig } = PaperTranslatorConfig;

  const fields = {
    enabled: document.getElementById("enabled"),
    autoTranslate: document.getElementById("autoTranslate"),
    cacheEnabled: document.getElementById("cacheEnabled"),
    contextEnhanced: document.getElementById("contextEnhanced"),
    displayMode: document.getElementById("displayMode"),
    apiMode: document.getElementById("apiMode"),
    apiEndpoint: document.getElementById("apiEndpoint"),
    apiKey: document.getElementById("apiKey"),
    model: document.getElementById("model"),
    targetLanguage: document.getElementById("targetLanguage"),
    glossary: document.getElementById("glossary"),
    maxConcurrentRequests: document.getElementById("maxConcurrentRequests"),
    urlRules: document.getElementById("urlRules"),
    translatePdfLinks: document.getElementById("translatePdfLinks")
  };

  const status = document.getElementById("status");

  function render(config) {
    fields.enabled.checked = config.enabled;
    fields.autoTranslate.checked = config.autoTranslate;
    fields.cacheEnabled.checked = config.cacheEnabled;
    fields.contextEnhanced.checked = config.contextEnhanced;
    fields.displayMode.value = config.displayMode;
    fields.apiMode.value = config.apiMode;
    fields.apiEndpoint.value = config.apiEndpoint;
    fields.apiKey.value = config.apiKey;
    fields.model.value = config.model;
    fields.targetLanguage.value = config.targetLanguage;
    fields.glossary.value = config.glossary;
    fields.maxConcurrentRequests.value = String(config.maxConcurrentRequests);
    fields.urlRules.value = config.urlRules.join("\n");
    fields.translatePdfLinks.checked = config.translatePdfLinks;
  }

  function readForm() {
    return normalizeConfig({
      enabled: fields.enabled.checked,
      autoTranslate: fields.autoTranslate.checked,
      cacheEnabled: fields.cacheEnabled.checked,
      contextEnhanced: fields.contextEnhanced.checked,
      displayMode: fields.displayMode.value,
      apiMode: fields.apiMode.value,
      apiEndpoint: fields.apiEndpoint.value.trim(),
      apiKey: fields.apiKey.value.trim(),
      model: fields.model.value.trim(),
      targetLanguage: fields.targetLanguage.value.trim() || "zh-CN",
      glossary: fields.glossary.value,
      maxConcurrentRequests: Number(fields.maxConcurrentRequests.value) || 3,
      urlRules: fields.urlRules.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      translatePdfLinks: fields.translatePdfLinks.checked
    });
  }

  function flash(message) {
    status.textContent = message;
    window.setTimeout(() => {
      status.textContent = "";
    }, 2200);
  }

  document.getElementById("save").addEventListener("click", async () => {
    await saveConfig(readForm());
    flash("已保存");
  });

  document.getElementById("reset").addEventListener("click", async () => {
    await saveConfig(DEFAULT_CONFIG);
    render(DEFAULT_CONFIG);
    flash("已恢复默认");
  });

  loadConfig().then(render);
})();
