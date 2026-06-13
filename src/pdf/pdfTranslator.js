(function (global) {
  // Rebuilds paragraphs from pdf.js getTextContent() items. PDF text comes as
  // positioned fragments in content-stream order, which for LaTeX papers is
  // close to reading order; we rebuild lines by baseline, then paragraphs by
  // gap / indent / font-size heuristics.

  function itemFontSize(item) {
    return Math.hypot(item.transform[2], item.transform[3]) || 10;
  }

  function isRotated(item) {
    // Vertical text such as the arXiv margin watermark.
    return Math.abs(item.transform[1]) > 1;
  }

  function buildLines(items) {
    const lines = [];
    let line = null;

    for (const item of items) {
      if (!item.str || isRotated(item)) continue;

      const size = itemFontSize(item);
      const x = item.transform[4];
      const y = item.transform[5];

      if (!item.str.trim()) {
        if (line) line.trailingSpace = true;
        continue;
      }

      const sameLine =
        line &&
        Math.abs(y - line.y) <= Math.max(2, Math.min(size, line.size) * 0.45) &&
        x >= line.endX - size * 1.5;

      if (sameLine) {
        const gap = x - line.endX;
        if (line.trailingSpace || gap > size * 0.15) line.text += " ";
        line.text += item.str;
        line.startX = Math.min(line.startX, x);
        line.endX = Math.max(line.endX, x + (item.width || 0));
        line.size = Math.max(line.size, size);
        line.top = Math.max(line.top, y + size * 0.85);
        line.bottom = Math.min(line.bottom, y - size * 0.25);
        line.trailingSpace = false;
      } else {
        if (line) lines.push(line);
        line = {
          text: item.str,
          y,
          size,
          startX: x,
          endX: x + (item.width || 0),
          top: y + size * 0.85,
          bottom: y - size * 0.25,
          trailingSpace: false
        };
      }
    }

    if (line) lines.push(line);
    return lines;
  }

  function isFurniture(line, pageHeight) {
    const text = line.text.trim();
    if (text.length <= 1) return true;
    // Page numbers and running headers/footers in the outer margins.
    const inMargin = line.y < pageHeight * 0.05 || line.y > pageHeight * 0.95;
    if (inMargin && text.length < 60) return true;
    return false;
  }

  function endsSentence(text) {
    return /[.?!:;]["')\]]?$/.test(text.trim());
  }

  const NUMBERED_HEADING = /^\d+(\.\d+)*\.?\s+[A-Za-z]/;

  function appendLine(paragraph, line) {
    const text = paragraph.text;
    if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(line.text)) {
      paragraph.text = text.slice(0, -1) + line.text; // undo hyphenation
    } else {
      paragraph.text = `${text} ${line.text}`;
    }

    paragraph.lineGap = paragraph.lastBaseline - line.y;
    paragraph.lastBaseline = line.y;
    // Track the latest line's size so the font-change check compares adjacent
    // lines (a heading followed by body text differs line-to-line even when
    // the paragraph started with yet another size).
    paragraph.size = line.size;
    paragraph.left = Math.min(paragraph.left, line.startX);
    paragraph.right = Math.max(paragraph.right, line.endX);
    paragraph.top = Math.max(paragraph.top, line.top);
    paragraph.bottom = Math.min(paragraph.bottom, line.bottom);
    paragraph.lineCount += 1;
  }

  function newParagraph(line) {
    return {
      text: line.text,
      size: line.size,
      left: line.startX,
      right: line.endX,
      top: line.top,
      bottom: line.bottom,
      lastBaseline: line.y,
      lineGap: line.size * 1.2,
      lineCount: 1
    };
  }

  function buildParagraphs(lines, pageWidth, pageHeight) {
    const paragraphs = [];
    let paragraph = null;

    const flush = () => {
      if (paragraph) paragraphs.push(paragraph);
      paragraph = null;
    };

    for (const line of lines) {
      if (isFurniture(line, pageHeight)) continue;

      if (paragraph) {
        const gap = paragraph.lastBaseline - line.y; // positive = moving down the page
        const movedUp = gap < -line.size; // jumped to a new column or float
        const bigGap = gap > Math.max(paragraph.lineGap * 1.7, line.size * 1.9);
        const fontChanged = Math.abs(line.size - paragraph.size) > paragraph.size * 0.15;
        const columnJump = Math.abs(line.startX - paragraph.left) > pageWidth * 0.3;
        const indented =
          line.startX - paragraph.left > line.size * 0.9 &&
          endsSentence(paragraph.text);
        // Numbered section headings ("1 Introduction", "3.2 Setup") stand
        // alone: break before one starts and after one ends, even when
        // spacing alone is inconclusive.
        const numberedHeading = NUMBERED_HEADING.test(line.text);
        const afterHeading =
          paragraph.lineCount === 1 && NUMBERED_HEADING.test(paragraph.text);

        if (movedUp || bigGap || fontChanged || columnJump || indented || numberedHeading || afterHeading) {
          flush();
        }
      }

      if (paragraph) {
        appendLine(paragraph, line);
      } else {
        paragraph = newParagraph(line);
      }
    }

    flush();
    return paragraphs;
  }

  function isTranslatable(text) {
    const compact = text.replace(/\s+/g, "");
    if (compact.length === 0) return false;
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    const words = (text.match(/[A-Za-z][A-Za-z-]{2,}/g) || []).length;
    // Single-word numbered headings ("1 Introduction") are still worth it.
    if (NUMBERED_HEADING.test(text) && letters >= 4 && text.length <= 80) {
      return true;
    }
    // Equation lines, table cells, and axis labels extract as symbol soup;
    // translating them only produces garbage, and the original page is shown
    // alongside anyway.
    return letters >= 8 && words >= 2 && letters / compact.length >= 0.4;
  }

  // Math in LaTeX PDFs extracts as characters from the Unicode math blocks
  // (mathematical alphanumerics 𝑨𝑥, Greek, arrows, operators, blackboard ℝ).
  // Sending those runs to a translation API mangles them and degrades the
  // surrounding sentence, so they are masked as placeholder tokens and
  // restored verbatim into the translation.
  const MATH_CHAR =
    /[Ͱ-Ͽ⁰-₟ℂℊ-ℓℕℙ-ℝℤΩ-ℨℬ-ℱ←-⇿∀-⋿⌀-⏿■-◿⟀-⟯⦀-⧿⨀-⫿]|\uD835[\uDC00-\uDFFF]/;

  // Short connector tokens that belong to a formula when surrounded by math
  // tokens on both sides: "= 0", "( x )", subscript digits, etc.
  const MATH_GLUE = /^[\d=+\-*/^_~|<>≤≥(){}[\],.;:!'`%]+$/;

  function maskMathRuns(text, placeholders) {
    const tokens = text.split(" ");
    const mathy = tokens.map((token) => MATH_CHAR.test(token));

    // A lone glue token between two math tokens is part of the same run.
    for (let i = 1; i < tokens.length - 1; i += 1) {
      if (!mathy[i] && mathy[i - 1] && mathy[i + 1] && MATH_GLUE.test(tokens[i])) {
        mathy[i] = true;
      }
    }

    const output = [];
    let index = 0;
    while (index < tokens.length) {
      if (!mathy[index]) {
        output.push(tokens[index]);
        index += 1;
        continue;
      }
      const start = index;
      while (index < tokens.length && mathy[index]) index += 1;
      const token = `[[PT_PH_${placeholders.length}]]`;
      placeholders.push({ token, text: tokens.slice(start, index).join(" ") });
      output.push(token);
    }

    return output.join(" ");
  }

  async function extractParagraphs(page) {
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const lines = buildLines(content.items);
    const paragraphs = buildParagraphs(lines, viewport.width, viewport.height);

    return paragraphs
      .map((paragraph) => ({
        text: paragraph.text.replace(/\s+/g, " ").trim(),
        // PDF-space rectangle [x0, y0, x1, y1] for the canvas hover highlight.
        rect: [paragraph.left, paragraph.bottom, paragraph.right, paragraph.top]
      }))
      .filter((paragraph) => isTranslatable(paragraph.text));
  }

  global.PaperTranslatorPdfText = {
    extractParagraphs,
    isTranslatable,
    maskMathRuns
  };
})(globalThis);
