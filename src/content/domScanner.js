(function (global) {
  // Leaf containers: text sitting directly in a div/dd with no block-level
  // children (OpenReview keyword lists, custom page metadata, etc.) would
  // otherwise be invisible to the tag-based selectors below.
  const LEAF_BLOCK_SELECTOR =
    "div:not(:has(div, p, ul, ol, dl, table, blockquote, pre, figure, section, article, h1, h2, h3, h4, h5, h6))";

  const CANDIDATE_SELECTOR = [
    "article h1",
    "article h2",
    "article h3",
    "article p",
    "article li",
    "article figcaption",
    "main h1",
    "main h2",
    "main h3",
    "main p",
    "main li",
    "main figcaption",
    ".ltx_title",
    ".ltx_p",
    ".ltx_abstract p",
    ".abstract p",
    "blockquote.abstract",
    "h1.title",
    "h1",
    "h2",
    "h3",
    "h4",
    "p",
    "li",
    "dd",
    // Accordion/FAQ triggers: content-like (long) button/summary text is real
    // copy. Short UI buttons ("Save", "Continue") are filtered by the body
    // length threshold in makeBlock.
    "button",
    "summary",
    LEAF_BLOCK_SELECTOR
  ].join(",");

  const PRESERVE_SELECTOR = [
    "math",
    "svg",
    "img",
    "canvas",
    "video",
    "audio",
    "pre",
    "code",
    "table",
    "sup",
    "sub",
    "cite",
    "a[href]",
    "mjx-container",
    ".MathJax",
    ".katex",
    ".katex-display",
    ".ltx_Math",
    ".ltx_equation",
    ".ltx_equationgroup",
    ".ltx_cite",
    ".ltx_ref",
    ".ltx_note",
    ".ltx_tag",
    // LaTeXML renders algorithm/code listings as divs, not <pre>.
    ".ltx_listing",
    ".ltx_listingline",
    ".equation"
  ].join(",");

  const SKIP_ANCESTOR_SELECTOR = [
    "script",
    "style",
    "noscript",
    "textarea",
    "input",
    "select",
    "nav",
    "header",
    "footer",
    "aside",
    "[contenteditable='true']",
    "[data-paper-translator-block]",
    "[data-paper-translator-ignore='true']",
    // Author/date lines: translating people's names transliterates them.
    ".ltx_authors",
    ".ltx_dates",
    ".authors"
  ].join(",");

  const SKIP_SERIALIZE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

  // Inline links up to this length are treated as citations / cross-references
  // ("[1]", "Figure 3") and preserved verbatim. Longer link text is real
  // content — typically a headline that is itself a link — and is descended
  // into so it gets translated instead of masked away to nothing.
  const LINK_PRESERVE_MAX_CHARS = 16;

  function shouldPreserveElement(element) {
    if (!element.matches(PRESERVE_SELECTOR)) return false;
    if (
      element.tagName === "A" &&
      (element.textContent || "").trim().length > LINK_PRESERVE_MAX_CHARS
    ) {
      return false;
    }
    return true;
  }

  let nextBlockNumber = 1;

  // Run-in titles render inline before their body ("Theorem 1.", "Proof.") and
  // \paragraph labels are one-word bold markers ("Results.", "Dataset.").
  // Injecting a block translation into them creates phantom headings, and the
  // labels carry no meaning worth translating — never make them blocks.
  const LABEL_TITLE_SELECTOR = [
    ".ltx_runin",
    ".ltx_title_theorem",
    ".ltx_title_proof",
    ".ltx_title_paragraph"
  ].join(",");

  // Structural titles are worth translating even when they are a single word
  // ("Introduction", "Abstract").
  const STRUCTURAL_TITLE_SELECTOR = [
    ".ltx_title_document",
    ".ltx_title_part",
    ".ltx_title_chapter",
    ".ltx_title_section",
    ".ltx_title_subsection",
    ".ltx_title_subsubsection",
    ".ltx_title_appendix",
    ".ltx_title_abstract",
    ".ltx_title_acknowledgements",
    ".ltx_title_bibliography"
  ].join(",");

  function headingKind(element) {
    if (element.matches(LABEL_TITLE_SELECTOR)) return "label";
    if (element.matches(STRUCTURAL_TITLE_SELECTOR)) return "structural";
    if (/^h[1-6]$/i.test(element.tagName) || element.classList.contains("ltx_title")) {
      return "heading";
    }
    return "body";
  }

  function hasEnglishText(text, relaxed) {
    const letters = text.match(/[A-Za-z]/g) || [];
    const asciiWords = text.match(/[A-Za-z][A-Za-z-]{2,}/g) || [];
    if (relaxed) return letters.length >= 4 && asciiWords.length >= 1;
    return letters.length >= 8 && asciiWords.length >= 2;
  }

  const MIN_TEXT_LENGTH = {
    structural: 4,
    heading: 8,
    body: 35
  };

  function hasCandidateAncestor(element) {
    const parent = element.parentElement;
    if (!parent) return false;
    const ancestor = parent.closest(CANDIDATE_SELECTOR);
    return Boolean(ancestor && ancestor !== document.body);
  }

  function isSkippable(element) {
    return (
      element.closest(SKIP_ANCESTOR_SELECTOR) ||
      element.matches(PRESERVE_SELECTOR) ||
      element.dataset.paperTranslatorBlock
    );
  }

  // Serialization must stay style-free: getComputedStyle here forces reflow per
  // node and was the main source of page jank.
  function serializeNode(node, parts, placeholders) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue || "");
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node;
    if (
      SKIP_SERIALIZE_TAGS.has(element.tagName) ||
      element.getAttribute("aria-hidden") === "true" ||
      element.hidden ||
      element.dataset.paperTranslatorIgnore === "true"
    ) {
      return;
    }

    if (shouldPreserveElement(element)) {
      const token = `[[PT_PH_${placeholders.length}]]`;
      placeholders.push({
        token,
        html: element.outerHTML
      });
      parts.push(token);
      return;
    }

    element.childNodes.forEach((child) => serializeNode(child, parts, placeholders));
  }

  function serializeBlock(element) {
    const parts = [];
    const placeholders = [];
    element.childNodes.forEach((child) => serializeNode(child, parts, placeholders));

    const text = parts
      .join("")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\n]+/g, " ")
      .trim();

    return {
      text,
      placeholders
    };
  }

  // Cheap per-element check: selector matching and textContent only. Full
  // serialization is deferred until the block is actually queued for
  // translation, so scanning a huge page stays fast.
  function makeBlock(element) {
    if (!(element instanceof HTMLElement)) return null;
    if (isSkippable(element) || hasCandidateAncestor(element)) return null;

    const kind = headingKind(element);
    if (kind === "label") return null;

    const text = (element.textContent || "").trim();
    // A question ("How does the bill work?") is translatable content even when
    // shorter than the body threshold — common for FAQ accordion triggers.
    const isQuestion = /[?？]\s*$/.test(text) && (text.match(/[A-Za-z][A-Za-z-]{1,}/g) || []).length >= 3;
    if ((text.length < MIN_TEXT_LENGTH[kind] && !isQuestion) || !hasEnglishText(text, kind === "structural")) {
      return null;
    }

    const id = `ptb-${Date.now()}-${nextBlockNumber++}`;
    element.dataset.paperTranslatorBlock = id;

    return {
      id,
      kind,
      element,
      sourceText: "",
      placeholders: [],
      originalNodes: null,
      serialized: false,
      translatedText: "",
      status: "pending",
      displayLanguage: "source",
      error: ""
    };
  }

  function collectCandidates(root) {
    const container = root && root.querySelectorAll ? root : document;
    if (container instanceof Element && container.closest(SKIP_ANCESTOR_SELECTOR)) {
      return [];
    }
    const found = Array.from(container.querySelectorAll(CANDIDATE_SELECTOR));
    if (container instanceof Element && container.matches(CANDIDATE_SELECTOR)) {
      found.unshift(container);
    }
    return found;
  }

  global.PaperTranslatorDomScanner = {
    collectCandidates,
    makeBlock,
    serializeBlock,
    hasEnglishText,
    PRESERVE_SELECTOR
  };
})(globalThis);
