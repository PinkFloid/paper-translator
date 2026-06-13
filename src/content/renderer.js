(function (global) {
  const STYLE_ID = "paper-translator-style";
  const STATUS_ID = "paper-translator-status";

  function ensureStyle(displayMode) {
    document.documentElement.dataset.paperTranslatorMode = displayMode;
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [data-paper-translator-block] {
        border-radius: 4px;
        transition: background-color 0.15s ease, box-shadow 0.15s ease;
      }

      [data-paper-translator-block]:hover {
        background-color: rgba(47, 110, 255, 0.08);
        box-shadow: 0 0 0 6px rgba(47, 110, 255, 0.08);
      }

      [data-paper-translator-block][data-paper-translator-status="translating"] {
        background-color: rgba(47, 110, 255, 0.06);
        box-shadow: 0 0 0 6px rgba(47, 110, 255, 0.06);
      }

      [data-paper-translator-block][data-paper-translator-status="error"] {
        cursor: pointer;
        background-color: rgba(224, 49, 49, 0.05);
        box-shadow: inset 3px 0 0 rgba(224, 49, 49, 0.55);
      }

      [data-paper-translator-block][data-paper-translator-status="error"]:hover {
        background-color: rgba(224, 49, 49, 0.1);
        box-shadow: inset 3px 0 0 rgba(224, 49, 49, 0.8), 0 0 0 6px rgba(224, 49, 49, 0.08);
      }

      html[data-paper-translator-mode="replace"]
        [data-paper-translator-block][data-paper-translator-status="translated"] {
        cursor: pointer;
      }

      html[data-paper-translator-mode="replace"]
        [data-paper-translator-block][data-paper-translator-display="target"] {
        background-image: linear-gradient(transparent calc(100% - 2px), rgba(47, 110, 255, 0.35) 0);
      }

      .paper-translator-bilingual {
        display: block;
        margin-top: 0.35em;
        padding: 0.3em 0.7em;
        border-left: 3px solid rgba(47, 110, 255, 0.55);
        border-radius: 0 5px 5px 0;
        background: rgba(47, 110, 255, 0.06);
      }

      .paper-translator-pdf-entry {
        display: inline-flex;
        align-items: center;
        margin-left: 8px;
        padding: 3px 7px;
        border: 1px solid #2f6eff;
        border-radius: 6px;
        color: #2f6eff !important;
        font: 12px/1.3 system-ui, sans-serif;
        text-decoration: none !important;
      }

      #paper-translator-status {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 420px;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(28, 32, 40, 0.92);
        color: #f3f5f9;
        box-shadow: 0 6px 20px rgba(15, 20, 30, 0.3);
        font: 12.5px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
        user-select: none;
        opacity: 1;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }

      #paper-translator-status[data-state="hidden"] {
        opacity: 0;
        transform: translateY(8px);
        pointer-events: none;
      }

      #paper-translator-status[data-state="error"] {
        background: rgba(140, 38, 38, 0.95);
        cursor: pointer;
      }

      #paper-translator-status .pt-dot {
        flex: none;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #4c8bff;
      }

      #paper-translator-status[data-state="working"] .pt-dot {
        background: transparent;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: #fff;
        animation: paper-translator-spin 0.8s linear infinite;
      }

      #paper-translator-status[data-state="done"] .pt-dot {
        background: #3ecf6e;
      }

      #paper-translator-status[data-state="error"] .pt-dot {
        background: #ff8787;
      }

      @keyframes paper-translator-spin {
        to { transform: rotate(360deg); }
      }

      @media (prefers-color-scheme: dark) {
        [data-paper-translator-block]:hover {
          background-color: rgba(108, 156, 255, 0.14);
          box-shadow: 0 0 0 6px rgba(108, 156, 255, 0.14);
        }

        .paper-translator-bilingual {
          border-left-color: rgba(108, 156, 255, 0.65);
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function initStatus(onClick) {
    let pill = document.getElementById(STATUS_ID);
    if (pill) return pill;

    pill = document.createElement("div");
    pill.id = STATUS_ID;
    pill.dataset.paperTranslatorIgnore = "true";
    pill.dataset.state = "hidden";

    const dot = document.createElement("span");
    dot.className = "pt-dot";
    const text = document.createElement("span");
    text.className = "pt-text";

    pill.append(dot, text);
    pill.addEventListener("click", () => onClick(pill.dataset.state));
    document.documentElement.appendChild(pill);
    return pill;
  }

  function updateStatus(state) {
    const pill = document.getElementById(STATUS_ID);
    if (!pill) return;
    pill.dataset.state = state.kind;
    pill.title = state.title || "";
    const text = pill.querySelector(".pt-text");
    if (text) text.textContent = state.text || "";
  }

  function nodeFromHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstElementChild || document.createTextNode("");
  }

  function appendTextWithPlaceholders(element, text, placeholders) {
    const byToken = new Map(placeholders.map((placeholder) => [placeholder.token, placeholder]));
    const tokenPattern = /\[\[PT_PH_\d+\]\]/g;
    let cursor = 0;
    let match = tokenPattern.exec(text);

    while (match) {
      if (match.index > cursor) {
        element.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      }

      const entry = byToken.get(match[0]);
      if (entry && entry.text != null) {
        // Glossary term placeholder: restore as plain text.
        element.appendChild(document.createTextNode(entry.text));
      } else if (entry && entry.html) {
        element.appendChild(nodeFromHtml(entry.html));
      }
      // No matching entry: drop the stray token rather than leaking the literal
      // [[PT_PH_n]] text (e.g. a token the model copied from the context).

      cursor = match.index + match[0].length;
      match = tokenPattern.exec(text);
    }

    if (cursor < text.length) {
      element.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function renderBilingual(block) {
    const previous = block.element.querySelector(":scope > .paper-translator-bilingual");
    if (previous) previous.remove();

    const node = document.createElement("span");
    node.className = "paper-translator-bilingual";
    node.dataset.paperTranslatorIgnore = "true";
    appendTextWithPlaceholders(node, block.translatedText, block.placeholders);
    block.element.appendChild(node);

    block.displayLanguage = "target";
    block.element.dataset.paperTranslatorDisplay = "target";
    block.element.removeAttribute("title");
  }

  function renderReplace(block, language) {
    // Snapshot real child nodes once so toggling back to the original keeps
    // links, emphasis, and already-typeset math intact.
    if (!block.originalNodes) {
      block.originalNodes = Array.from(block.element.childNodes);
    }

    if (language === "target") {
      block.element.replaceChildren();
      appendTextWithPlaceholders(block.element, block.translatedText, block.placeholders);
      block.element.title = "点击查看原文";
    } else {
      block.element.replaceChildren(...block.originalNodes);
      block.element.title = "点击查看译文";
    }

    block.displayLanguage = language;
    block.element.dataset.paperTranslatorDisplay = language;
  }

  function renderTranslated(block, displayMode) {
    if (displayMode === "replace") {
      renderReplace(block, "target");
    } else {
      renderBilingual(block);
    }
    block.element.dataset.paperTranslatorStatus = block.status;
  }

  function markStatus(block) {
    block.element.dataset.paperTranslatorStatus = block.status;
    if (block.status === "error") {
      block.element.title = `翻译失败：${block.error || "未知错误"}（点击重试）`;
    } else if (block.status !== "translated") {
      block.element.removeAttribute("title");
    }
  }

  function toggle(block) {
    if (!block || !block.translatedText) return;
    renderReplace(block, block.displayLanguage === "target" ? "source" : "target");
  }

  global.PaperTranslatorRenderer = {
    ensureStyle,
    initStatus,
    updateStatus,
    renderTranslated,
    markStatus,
    toggle
  };
})(globalThis);
