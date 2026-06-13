(function () {
  const { MESSAGE_TYPES } = PaperTranslatorConstants;
  const { loadConfig, urlMatchesRules, isPdfUrl } = PaperTranslatorConfig;
  const { parseUserGlossary, extractTerms, annotateAmbiguousEntries, maskTerms } = PaperTranslatorGlossary;
  const { collectCandidates, makeBlock, serializeBlock } = PaperTranslatorDomScanner;
  const { createBlockManager } = PaperTranslatorBlockManager;
  const { ensureStyle, initStatus, updateStatus, renderTranslated, markStatus, toggle } = PaperTranslatorRenderer;
  const { createReadingObserver } = PaperTranslatorReadingObserver;

  const manager = createBlockManager();
  const queue = [];

  // With all_frames the script runs inside every iframe too (NYTimes-style
  // embedded subscription/checkout modules etc.). Frame-level chrome like the
  // status pill and the PDF entry only belong in the top document.
  const inTopFrame = window.top === window.self;

  let config = null;
  let active = false;
  let readingObserver = null;
  let inFlight = 0;
  let maxInFlight = 4;
  let lastError = "";
  let pdfEntryAdded = false;
  let statusRefreshScheduled = false;
  let doneHideTimer = 0;
  let documentContext = null;
  let userGlossaryEntries = [];
  let contextReady = false;
  const idsAwaitingContext = [];

  const scheduleIdle =
    typeof window.requestIdleCallback === "function"
      ? (callback) => window.requestIdleCallback(callback, { timeout: 500 })
      : (callback) => window.setTimeout(callback, 32);

  function sendMessageWithTimeout(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(`请求超时（${timeoutMs / 1000} 秒）`));
      }, timeoutMs);

      chrome.runtime
        .sendMessage(message)
        .then((response) => {
          window.clearTimeout(timer);
          resolve(response);
        })
        .catch((error) => {
          window.clearTimeout(timer);
          reject(error);
        });
    });
  }

  // ---- status pill -------------------------------------------------------

  function refreshStatusNow() {
    const counts = manager.counts();
    const activeCount = counts.queued + counts.translating;
    window.clearTimeout(doneHideTimer);

    if (activeCount > 0) {
      updateStatus({
        kind: "working",
        text:
          `正在翻译 ${activeCount} 段 · 已完成 ${counts.translated}` +
          (counts.error > 0 ? ` · 失败 ${counts.error}` : ""),
        title: lastError
      });
      return;
    }

    if (counts.error > 0) {
      updateStatus({
        kind: "error",
        text: `${counts.error} 段翻译失败，点击重试`,
        title: lastError
      });
      return;
    }

    if (counts.translated > 0) {
      updateStatus({ kind: "done", text: `已翻译 ${counts.translated} 段` });
      doneHideTimer = window.setTimeout(() => {
        updateStatus({ kind: "hidden" });
      }, 2500);
      return;
    }

    updateStatus({ kind: "hidden" });
  }

  function refreshStatus() {
    if (statusRefreshScheduled) return;
    statusRefreshScheduled = true;
    window.requestAnimationFrame(() => {
      statusRefreshScheduled = false;
      refreshStatusNow();
    });
  }

  function onStatusClick(state) {
    if (state === "error") {
      retryBlocks(manager.idsWithStatus("error"));
    } else {
      updateStatus({ kind: "hidden" });
    }
  }

  // ---- document context (title + proper-noun glossary) ---------------------

  // Computed once after the initial scan so every block of the document is
  // translated with the same terminology; later DOM mutations don't change it.
  function computeDocumentContext() {
    if (contextReady) return;

    const heading = document.querySelector("h1");
    const title = ((heading && heading.textContent) || document.title || "")
      .replace(/^\[[^\]]+\]\s*/, "")
      .replace(/^Title:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);

    userGlossaryEntries = parseUserGlossary(config.glossary);
    const userTerms = new Set(userGlossaryEntries.map((entry) => entry.term.toLowerCase()));

    const texts = manager
      .all()
      .slice(0, 400)
      .map((block) => (block.element.textContent || "").slice(0, 2000));
    texts.push(title);

    annotateAmbiguousEntries(userGlossaryEntries, texts);
    const ambiguousTerms = userGlossaryEntries
      .filter((entry) => entry.skipSentenceInitial)
      .map((entry) => entry.term);

    const terms = extractTerms(texts).filter((term) => !userTerms.has(term.toLowerCase()));

    documentContext = { title, terms, ambiguousTerms };
    contextReady = true;
    globalThis.__paperTranslatorContext = documentContext;

    if (idsAwaitingContext.length > 0) {
      enqueue(idsAwaitingContext.splice(0));
    }
  }

  // ---- translation pipeline ----------------------------------------------

  function isRenderable(element) {
    return typeof element.checkVisibility === "function" ? element.checkVisibility() : true;
  }

  // Serialization (placeholder extraction) is deferred to this point so the
  // initial scan never walks block subtrees.
  function ensureSerialized(block) {
    if (block.serialized) return block.status !== "skipped";
    block.serialized = true;

    if (!block.element.isConnected || !isRenderable(block.element)) {
      block.status = "skipped";
      return false;
    }

    const serialized = serializeBlock(block.element);
    const stripped = serialized.text.replace(/\[\[PT_PH_\d+\]\]/g, " ");
    if (!/[A-Za-z]{2}/.test(stripped)) {
      block.status = "skipped";
      return false;
    }

    // Clean unmasked text, kept for use as the next block's context.
    block.contextText = serialized.text.slice(0, 600);
    // User glossary terms become placeholders so any API keeps them verbatim.
    block.sourceText = maskTerms(serialized.text, userGlossaryEntries, serialized.placeholders);
    block.placeholders = serialized.placeholders;
    return true;
  }

  function contextBeforeOf(block) {
    if (!config.contextEnhanced || !block.prevId) return "";
    const prev = manager.get(block.prevId);
    if (!prev) return "";
    if (prev.contextText) return prev.contextText;
    // Not serialized yet: fall back to raw text (no translation inserted yet,
    // since untranslated blocks never carry a bilingual node).
    return (prev.element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600);
  }

  function enqueue(ids) {
    if (!contextReady) {
      idsAwaitingContext.push(...ids);
      return manager.pendingFromIds(ids).length;
    }

    const pending = manager.pendingFromIds(ids);
    let queued = 0;

    pending.forEach((block) => {
      if (!ensureSerialized(block)) return;
      block.status = "queued";
      queue.push(block.id);
      queued += 1;
    });

    if (queued > 0) {
      refreshStatus();
      pump();
    }
    return queued;
  }

  function retryBlocks(ids) {
    ids.forEach((id) => {
      const block = manager.get(id);
      if (block && block.status === "error") {
        block.status = "pending";
        block.error = "";
        markStatus(block);
      }
    });
    enqueue(ids);
  }

  async function translateBlock(block) {
    block.status = "translating";
    markStatus(block);

    try {
      const response = await sendMessageWithTimeout(
        {
          type: MESSAGE_TYPES.TRANSLATE_BLOCKS,
          payload: {
            sourceUrl: location.href,
            targetLanguage: config.targetLanguage,
            context: documentContext,
            blocks: [{ id: block.id, text: block.sourceText, contextBefore: contextBeforeOf(block) }]
          }
        },
        60000
      );

      if (!response) throw new Error("后台无响应");
      if (response.error) throw new Error(response.error);

      const result = response.results && response.results[0];
      if (!result) throw new Error("后台未返回结果");
      if (result.error) throw new Error(result.error);
      if (!result.translatedText) throw new Error("译文为空");

      let translated = result.translatedText;
      if (block.kind === "structural" || block.kind === "heading") {
        // "Abstract." should become "摘要", not "摘要。".
        translated = translated.replace(/[。．.\s]+$/, "");
      }

      block.translatedText = translated;
      block.status = "translated";
      renderTranslated(block, config.displayMode);
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      block.status = "error";
      block.error = lastError;
      markStatus(block);
    }
  }

  // One block per request, several requests in flight: results render as soon
  // as each block finishes instead of waiting for a whole batch.
  function pump() {
    while (inFlight < maxInFlight && queue.length > 0) {
      const block = manager.get(queue.shift());
      if (!block || block.status !== "queued") continue;

      inFlight += 1;
      translateBlock(block).finally(() => {
        inFlight -= 1;
        refreshStatus();
        pump();
      });
    }
    refreshStatus();
  }

  // ---- scanning ----------------------------------------------------------

  function scanAndObserve(root, onComplete) {
    const candidates = collectCandidates(root);
    if (candidates.length === 0) {
      if (onComplete) onComplete();
      return;
    }

    let index = 0;
    const CHUNK_SIZE = 250;

    const step = () => {
      const blocks = [];
      const end = Math.min(index + CHUNK_SIZE, candidates.length);
      for (; index < end; index += 1) {
        const block = makeBlock(candidates[index]);
        if (block) blocks.push(block);
      }

      if (blocks.length > 0) {
        manager.addMany(blocks);
        readingObserver.observe(blocks);
      }

      if (index < candidates.length) {
        scheduleIdle(step);
      } else if (onComplete) {
        onComplete();
      }
    };

    // The first chunk runs synchronously so above-the-fold content starts
    // translating immediately; the rest yields to the main thread.
    step();
  }

  function onBlocksVisible(ids) {
    if (!config.autoTranslate) return;
    enqueue(ids);
  }

  // ---- dynamic pages -----------------------------------------------------

  function listenForMutations() {
    if (!document.body) return;

    const pendingRoots = new Set();
    let timer = 0;

    const processRoots = () => {
      if (pendingRoots.size > 25) {
        // Big DOM swap (SPA navigation etc.): one idempotent full rescan is
        // cheaper than filtering hundreds of roots.
        pendingRoots.clear();
        scanAndObserve(document);
      } else {
        const roots = Array.from(pendingRoots);
        pendingRoots.clear();
        roots
          .filter((element) => element.isConnected)
          .filter((element) => !element.closest("[data-paper-translator-ignore='true']"))
          .filter((element) => !element.closest("[data-paper-translator-block]"))
          .forEach(scanAndObserve);
      }
      addPdfEntry();
    };

    const observer = new MutationObserver((mutations) => {
      // Keep this callback minimal; it can fire hundreds of times per second
      // while MathJax or a SPA framework is working.
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            pendingRoots.add(node);
          }
        }
      }
      if (pendingRoots.size === 0) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(processRoots, 350);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ---- interactions ------------------------------------------------------

  function listenForClicks() {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (target.closest("a[href]")) return; // never hijack links

        const blockElement = target.closest("[data-paper-translator-block]");
        if (!blockElement) return;

        const block = manager.get(blockElement.dataset.paperTranslatorBlock);
        if (!block) return;

        if (block.status === "error") {
          event.preventDefault();
          event.stopPropagation();
          retryBlocks([block.id]);
          return;
        }

        if (config.displayMode === "replace" && block.translatedText) {
          event.preventDefault();
          event.stopPropagation();
          toggle(block);
        }
      },
      true
    );
  }

  function addPdfEntry() {
    if (!inTopFrame || !config.translatePdfLinks || pdfEntryAdded) return;

    const links = Array.from(document.querySelectorAll("a[href]"));
    const pdfLink = links.find((link) => {
      if (link.dataset.paperTranslatorPdfEntry) return false;
      try {
        const href = new URL(link.getAttribute("href"), location.href).href;
        return isPdfUrl(href);
      } catch (_error) {
        return false;
      }
    });

    if (!pdfLink) return;

    const href = new URL(pdfLink.getAttribute("href"), location.href).href;
    pdfLink.dataset.paperTranslatorPdfEntry = "true";

    const entry = document.createElement("a");
    entry.className = "paper-translator-pdf-entry";
    entry.dataset.paperTranslatorIgnore = "true";
    entry.href = chrome.runtime.getURL(`src/pdf/pdfViewer.html?src=${encodeURIComponent(href)}`);
    entry.target = "_blank";
    entry.rel = "noopener noreferrer";
    entry.textContent = "翻译 PDF";
    pdfLink.insertAdjacentElement("afterend", entry);
    pdfEntryAdded = true;
  }

  // ---- messages from popup -----------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;

    // Force the page on even when its URL is not in the rules ("translate
    // this page" / "always translate this site" from the popup).
    if (message.type === MESSAGE_TYPES.ACTIVATE_PAGE) {
      // The popup broadcasts to every frame; each iframe activates and
      // translates its own content, but only the top frame replies (otherwise
      // multiple responders trigger a message-channel warning).
      activate().then(() => {
        if (!inTopFrame) return;
        const queued = enqueue(manager.idsWithStatus("pending"));
        sendResponse({ activated: true, queued, total: manager.counts().total });
      });
      return inTopFrame; // only the top frame keeps the channel open to respond
    }

    if (message.type === MESSAGE_TYPES.TRANSLATE_PAGE) {
      if (!active) {
        sendResponse({ inactive: true, queued: 0 });
        return false;
      }
      const queued = enqueue(manager.idsWithStatus("pending"));
      sendResponse({ queued, total: manager.counts().total });
      return false;
    }

    return false;
  });

  // ---- bootstrap ----------------------------------------------------------

  // Everything needed to start translating the current document. Split out of
  // main() so the popup can switch a non-matching page on by message.
  async function activate() {
    if (active) return;
    if (!config) config = await loadConfig();
    active = true;
    maxInFlight = Math.min(Math.max(Number(config.maxConcurrentRequests) || 4, 1), 8);

    ensureStyle(config.displayMode);
    if (inTopFrame) initStatus(onStatusClick);
    readingObserver = createReadingObserver(onBlocksVisible);
    listenForClicks();
    scanAndObserve(document, computeDocumentContext);
    // Safety net: never leave the first batch waiting if the scan stalls.
    window.setTimeout(computeDocumentContext, 4000);
    addPdfEntry();
    listenForMutations();
  }

  async function main() {
    config = await loadConfig();
    if (config.enabled && urlMatchesRules(location.href, config.urlRules)) {
      activate();
    }
  }

  main();
})();
