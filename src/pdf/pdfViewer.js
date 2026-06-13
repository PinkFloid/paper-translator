import * as pdfjsLib from "../../vendor/pdfjs/pdf.min.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../../vendor/pdfjs/pdf.worker.min.js",
  import.meta.url
).toString();

const { MESSAGE_TYPES } = globalThis.PaperTranslatorConstants;
const { loadConfig } = globalThis.PaperTranslatorConfig;
const { extractParagraphs, maskMathRuns } = globalThis.PaperTranslatorPdfText;
const { parseUserGlossary, extractTerms, annotateAmbiguousEntries, maskTerms } =
  globalThis.PaperTranslatorGlossary;

const MAX_RENDERED_PAGES = 12;

const pagesContainer = document.getElementById("pages");
const progressEl = document.getElementById("progress");
const bannerEl = document.getElementById("banner");
const docTitleEl = document.getElementById("docTitle");
const sourceLinkEl = document.getElementById("sourceLink");
const translateAllButton = document.getElementById("translateAll");

const blocks = new Map(); // id -> {text, el, state, rect, pageNum}
const pageLastBlockId = new Map(); // pageNum -> id of its last paragraph
const pageStates = new Map(); // pageNum -> {row, canvasWrap, textPane, viewport, rendered, extracted}
const queue = [];
const renderedPages = [];

let config = null;
let pdf = null;
let inFlight = 0;
let maxInFlight = 4;
let lastError = "";
let estimatedRowHeight = 900;
let documentContext = null;
let userGlossaryEntries = [];

function showBanner(message) {
  bannerEl.textContent = message;
  bannerEl.hidden = false;
}

// ---- progress ------------------------------------------------------------

function refreshProgress() {
  let waiting = 0;
  let done = 0;
  let failed = 0;
  blocks.forEach((block) => {
    if (block.state === "queued" || block.state === "translating") waiting += 1;
    if (block.state === "done") done += 1;
    if (block.state === "error") failed += 1;
  });

  if (waiting > 0) {
    progressEl.dataset.state = "working";
    progressEl.textContent =
      `正在翻译 ${waiting} 段 · 已完成 ${done}` + (failed > 0 ? ` · 失败 ${failed}` : "");
  } else if (failed > 0) {
    progressEl.dataset.state = "error";
    progressEl.textContent = `${failed} 段翻译失败，点击重试`;
    progressEl.title = lastError;
  } else if (done > 0) {
    progressEl.dataset.state = "idle";
    progressEl.textContent = `已翻译 ${done} 段`;
  } else {
    progressEl.dataset.state = "idle";
    progressEl.textContent = "";
  }
}

progressEl.addEventListener("click", () => {
  if (progressEl.dataset.state !== "error") return;
  blocks.forEach((block, id) => {
    if (block.state === "error") {
      block.state = "queued";
      block.el.dataset.state = "waiting";
      queue.push(id);
    }
  });
  pump();
});

// ---- translation pipeline --------------------------------------------------

function sendMessageWithTimeout(message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`请求超时（${timeoutMs / 1000} 秒）`));
    }, timeoutMs);
    chrome.runtime
      .sendMessage(message)
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function contextBeforeOf(block) {
  if (!config.contextEnhanced || !block.prevId) return "";
  const prev = blocks.get(block.prevId);
  return prev ? prev.displayText.slice(0, 600) : "";
}

async function translateBlock(id) {
  const block = blocks.get(id);
  block.state = "translating";
  block.el.dataset.state = "translating";

  try {
    const response = await sendMessageWithTimeout(
      {
        type: MESSAGE_TYPES.TRANSLATE_BLOCKS,
        payload: {
          sourceUrl: sourceLinkEl.href,
          targetLanguage: config.targetLanguage,
          context: documentContext,
          blocks: [{ id, text: block.text, contextBefore: contextBeforeOf(block) }]
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
    block.placeholders.forEach((placeholder) => {
      translated = translated.split(placeholder.token).join(placeholder.text);
    });
    // Drop any token the model copied from the context that has no entry here.
    translated = translated.replace(/\[\[PT_PH_\d+\]\]/g, "").replace(/\s{2,}/g, " ");

    block.state = "done";
    block.el.dataset.state = "done";
    block.el.querySelector(".pt-text").textContent = translated;
    block.el.title = "点击查看原文";
  } catch (error) {
    lastError = error && error.message ? error.message : String(error);
    block.state = "error";
    block.el.dataset.state = "error";
    block.el.title = `翻译失败：${lastError}（点击重试）`;
  }
}

function pump() {
  while (inFlight < maxInFlight && queue.length > 0) {
    const id = queue.shift();
    const block = blocks.get(id);
    if (!block || block.state !== "queued") continue;
    inFlight += 1;
    translateBlock(id).finally(() => {
      inFlight -= 1;
      refreshProgress();
      pump();
    });
  }
  refreshProgress();
}

function enqueuePage(pageNum) {
  let added = 0;
  blocks.forEach((block, id) => {
    if (block.pageNum === pageNum && block.state === "idle") {
      block.state = "queued";
      queue.push(id);
      added += 1;
    }
  });
  if (added > 0) pump();
}

// ---- page rendering --------------------------------------------------------

function makeBlockElement(id, block) {
  const el = document.createElement("div");
  el.className = "pt-block";
  el.dataset.state = "waiting";
  el.dataset.blockId = id;

  const textEl = document.createElement("div");
  textEl.className = "pt-text";
  textEl.textContent = block.displayText;

  const sourceEl = document.createElement("div");
  sourceEl.className = "pt-source";
  sourceEl.textContent = block.displayText;

  el.append(textEl, sourceEl);

  el.addEventListener("mouseenter", () => showHighlight(block));
  el.addEventListener("mouseleave", () => hideHighlight(block.pageNum));
  el.addEventListener("click", () => {
    if (el.dataset.state === "error") {
      const entry = blocks.get(id);
      entry.state = "queued";
      el.dataset.state = "waiting";
      queue.push(id);
      pump();
    } else if (el.dataset.state === "done") {
      el.dataset.showSource = el.dataset.showSource === "true" ? "false" : "true";
    }
  });

  return el;
}

function showHighlight(block) {
  const state = pageStates.get(block.pageNum);
  if (!state || !state.viewport) return;
  const [x1, y1, x2, y2] = state.viewport.convertToViewportRectangle(block.rect);
  const highlight = state.canvasWrap.querySelector(".page-highlight");
  highlight.style.left = `${Math.min(x1, x2) - 3}px`;
  highlight.style.top = `${Math.min(y1, y2) - 3}px`;
  highlight.style.width = `${Math.abs(x2 - x1) + 6}px`;
  highlight.style.height = `${Math.abs(y2 - y1) + 6}px`;
  highlight.style.display = "block";
}

function hideHighlight(pageNum) {
  const state = pageStates.get(pageNum);
  if (!state) return;
  state.canvasWrap.querySelector(".page-highlight").style.display = "none";
}

async function ensureExtracted(pageNum) {
  const state = pageStates.get(pageNum);
  if (state.extracted) return;
  state.extracted = true;

  const page = await pdf.getPage(pageNum);
  const paragraphs = await extractParagraphs(page);

  let prevId = pageLastBlockId.get(pageNum - 1) || null;
  paragraphs.forEach((paragraph, index) => {
    const id = `p${pageNum}-${index}`;
    const placeholders = [];
    const block = {
      text: maskMathRuns(maskTerms(paragraph.text, userGlossaryEntries, placeholders), placeholders),
      displayText: paragraph.text,
      placeholders,
      rect: paragraph.rect,
      pageNum,
      prevId,
      state: "idle",
      el: null
    };
    prevId = id;
    block.el = makeBlockElement(id, block);
    blocks.set(id, block);
    state.textPane.appendChild(block.el);
  });
  if (prevId) pageLastBlockId.set(pageNum, prevId);

  if (paragraphs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "page-number";
    empty.textContent = "本页没有可翻译的正文（可能是图表或公式页）";
    state.textPane.appendChild(empty);
  }
}

function evictDistantPages(currentPageNum) {
  while (renderedPages.length > MAX_RENDERED_PAGES) {
    renderedPages.sort(
      (a, b) => Math.abs(a - currentPageNum) - Math.abs(b - currentPageNum)
    );
    const victim = renderedPages.pop();
    const state = pageStates.get(victim);
    const canvas = state.canvasWrap.querySelector("canvas");
    if (canvas) {
      const placeholder = document.createElement("div");
      placeholder.className = "page-placeholder";
      placeholder.style.height = `${canvas.getBoundingClientRect().height}px`;
      placeholder.textContent = `第 ${victim} 页`;
      canvas.replaceWith(placeholder);
      canvas.width = 0;
      canvas.height = 0;
    }
    state.rendered = false;
  }
}

async function renderPage(pageNum) {
  const state = pageStates.get(pageNum);
  if (state.rendered) return;
  state.rendered = true;

  const page = await pdf.getPage(pageNum);
  const wrapWidth = state.canvasWrap.clientWidth || 700;
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = wrapWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });
  state.viewport = viewport;

  const outputScale = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = "100%";

  const context = canvas.getContext("2d");
  await page.render({
    canvasContext: context,
    viewport,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
  }).promise;

  const placeholder = state.canvasWrap.querySelector(".page-placeholder, canvas");
  if (placeholder) {
    placeholder.replaceWith(canvas);
  } else {
    state.canvasWrap.appendChild(canvas);
  }

  estimatedRowHeight = viewport.height;
  renderedPages.push(pageNum);
  evictDistantPages(pageNum);
}

function buildPageRows(pageCount) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const pageNum = Number(entry.target.dataset.page);
        renderPage(pageNum).catch((error) => {
          console.error("renderPage failed", error);
          pageStates.get(pageNum).rendered = false;
        });
        ensureExtracted(pageNum)
          .then(() => enqueuePage(pageNum))
          .catch((error) => console.error("extract failed", error));
      });
    },
    { rootMargin: "1000px 0px 1400px 0px" }
  );

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const row = document.createElement("section");
    row.className = "page-row";
    row.dataset.page = String(pageNum);

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "page-canvas-wrap";

    const placeholder = document.createElement("div");
    placeholder.className = "page-placeholder";
    placeholder.style.height = `${estimatedRowHeight}px`;
    placeholder.textContent = `第 ${pageNum} 页`;
    canvasWrap.appendChild(placeholder);

    const highlight = document.createElement("div");
    highlight.className = "page-highlight";
    canvasWrap.appendChild(highlight);

    const textPane = document.createElement("div");
    textPane.className = "page-text";
    const pageLabel = document.createElement("p");
    pageLabel.className = "page-number";
    pageLabel.textContent = `第 ${pageNum} 页`;
    textPane.appendChild(pageLabel);

    row.append(canvasWrap, textPane);
    pagesContainer.appendChild(row);
    pageStates.set(pageNum, {
      row,
      canvasWrap,
      textPane,
      viewport: null,
      rendered: false,
      extracted: false
    });
    observer.observe(row);
  }
}

// ---- translate all ---------------------------------------------------------

translateAllButton.addEventListener("click", async () => {
  if (!pdf) return;
  translateAllButton.disabled = true;
  translateAllButton.textContent = "正在提取…";
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      await ensureExtracted(pageNum);
      enqueuePage(pageNum);
    }
  } finally {
    translateAllButton.textContent = "翻译整篇";
    translateAllButton.disabled = false;
  }
});

// ---- bootstrap ---------------------------------------------------------------

async function main() {
  const params = new URLSearchParams(location.search);
  const src = params.get("src") || "";

  if (!src) {
    showBanner("未提供 PDF 地址。请从论文页的“翻译 PDF”入口打开本页面。");
    translateAllButton.disabled = true;
    return;
  }

  const fileName = (() => {
    try {
      const url = new URL(src);
      return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || src);
    } catch (_error) {
      return src;
    }
  })();
  docTitleEl.textContent = fileName;
  document.title = `${fileName} - PDF 翻译阅读器`;
  sourceLinkEl.href = src;

  config = await loadConfig();
  maxInFlight = Math.min(Math.max(Number(config.maxConcurrentRequests) || 4, 1), 8);

  if (!config.apiEndpoint) {
    showBanner("尚未配置翻译 API。请先在扩展设置中填写 API Endpoint，然后刷新本页。");
  }

  progressEl.textContent = "正在加载 PDF…";

  try {
    pdf = await pdfjsLib.getDocument({ url: src, isEvalSupported: false }).promise;
  } catch (error) {
    showBanner(`PDF 加载失败：${error && error.message ? error.message : error}`);
    progressEl.textContent = "";
    translateAllButton.disabled = true;
    return;
  }

  // Use the first page's aspect ratio for placeholder heights.
  const firstPage = await pdf.getPage(1);
  const baseViewport = firstPage.getViewport({ scale: 1 });
  const wrapWidth = Math.min(0.54 * (pagesContainer.clientWidth - 18), 900);
  estimatedRowHeight = wrapWidth * (baseViewport.height / baseViewport.width);

  await buildDocumentContext(fileName);

  progressEl.textContent = "";
  buildPageRows(pdf.numPages);
}

// The title plus proper nouns from the opening pages give every block the
// same terminology (model names stay in English instead of being translated
// literally in some paragraphs).
async function buildDocumentContext(fileName) {
  let title = "";
  try {
    const metadata = await pdf.getMetadata();
    title = (metadata && metadata.info && metadata.info.Title) || "";
  } catch (_error) {
    // metadata is optional
  }

  const sampleTexts = [];
  try {
    const samplePages = Math.min(3, pdf.numPages);
    for (let pageNum = 1; pageNum <= samplePages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const paragraphs = await extractParagraphs(page);
      paragraphs.forEach((paragraph) => sampleTexts.push(paragraph.text));
    }
  } catch (_error) {
    // term extraction is best-effort
  }

  if (!title) {
    // Fall back to the first short block on page 1 (usually the title line).
    title = (sampleTexts.find((text) => text.length >= 15 && text.length <= 250) || fileName).trim();
  }
  title = title.replace(/\s+/g, " ").slice(0, 200);
  sampleTexts.push(title);

  userGlossaryEntries = parseUserGlossary(config.glossary);
  const userTerms = new Set(userGlossaryEntries.map((entry) => entry.term.toLowerCase()));

  annotateAmbiguousEntries(userGlossaryEntries, sampleTexts);
  const ambiguousTerms = userGlossaryEntries
    .filter((entry) => entry.skipSentenceInitial)
    .map((entry) => entry.term);

  const terms = extractTerms(sampleTexts).filter((term) => !userTerms.has(term.toLowerCase()));

  documentContext = { title, terms, ambiguousTerms };
  globalThis.__paperTranslatorContext = documentContext;
}

main();
