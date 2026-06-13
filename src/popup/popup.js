(function () {
  const { MESSAGE_TYPES, EXTENSION_AUTHOR } = PaperTranslatorConstants;
  document.getElementById("credit").textContent = `Made by ${EXTENSION_AUTHOR}`;
  const { loadConfig, saveConfig, urlMatchesRules, isPdfUrl } = PaperTranslatorConfig;

  const enabled = document.getElementById("enabled");
  const autoTranslate = document.getElementById("autoTranslate");
  const currentStatus = document.getElementById("currentStatus");
  const addSiteButton = document.getElementById("addSite");

  let currentConfig = null;
  let sitePattern = "";

  function setStatus(lines) {
    currentStatus.textContent = Array.isArray(lines) ? lines.join("\n") : lines;
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function refresh() {
    currentConfig = await loadConfig();
    enabled.checked = currentConfig.enabled;
    autoTranslate.checked = currentConfig.autoTranslate;

    const tab = await getActiveTab();
    const url = tab && tab.url ? tab.url : "";
    const matched = urlMatchesRules(url, currentConfig.urlRules);
    const apiReady = Boolean(currentConfig.apiEndpoint);

    document.getElementById("translatePdf").hidden = !isPdfUrl(url);

    // Offer "always translate this site" only on a normal web page that isn't
    // already covered by the rules.
    let host = "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        host = parsed.hostname;
        sitePattern = `${parsed.protocol}//${host}/*`;
      }
    } catch (_error) {
      host = "";
    }

    if (host && !matched) {
      addSiteButton.textContent = `✚ 始终翻译 ${host}`;
      addSiteButton.hidden = false;
    } else {
      sitePattern = "";
      addSiteButton.hidden = true;
    }

    setStatus([
      matched ? "当前页面：匹配网址规则" : "当前页面：不在规则内（可临时翻译）",
      apiReady ? `API 模式：${currentConfig.apiMode}` : "尚未配置 API Endpoint",
      `显示方式：${currentConfig.displayMode === "replace" ? "仅译文" : "双语对照"}`
    ]);
  }

  document.getElementById("translatePage").addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: MESSAGE_TYPES.ACTIVATE_PAGE
      });
      if (response && response.queued > 0) {
        setStatus(`已开始翻译，加入 ${response.queued} 段。`);
      } else if (response && response.total === 0) {
        setStatus("此页面没有检测到可翻译的英文段落。");
      } else {
        setStatus("已开始翻译当前页面。");
      }
    } catch (_error) {
      setStatus("此页面不支持翻译（如 chrome:// 或浏览器商店页面）。");
    }
  });

  addSiteButton.addEventListener("click", async () => {
    if (!sitePattern) return;

    const rules = currentConfig.urlRules.slice();
    if (!rules.includes(sitePattern)) rules.push(sitePattern);
    currentConfig = { ...currentConfig, urlRules: rules };
    await saveConfig(currentConfig);
    addSiteButton.hidden = true;

    const tab = await getActiveTab();
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.ACTIVATE_PAGE });
      } catch (_error) {
        // content script not present on this page; rule still saved for reloads
      }
    }
    setStatus("已加入自动翻译列表，并开始翻译当前页面。");
  });

  document.getElementById("translatePdf").addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.url) return;
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`src/pdf/pdfViewer.html?src=${encodeURIComponent(tab.url)}`)
    });
    window.close();
  });

  document.getElementById("save").addEventListener("click", async () => {
    await saveConfig({
      ...currentConfig,
      enabled: enabled.checked,
      autoTranslate: autoTranslate.checked
    });
    setStatus("已保存，刷新论文页面后生效。");
  });

  document.getElementById("options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("clearCache").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_CACHE });
    setStatus("缓存已清空。");
  });

  refresh();
})();
