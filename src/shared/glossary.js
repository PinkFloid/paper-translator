(function (global) {
  // Common capitalized words in papers that must never be treated as proper
  // nouns even when they appear mid-sentence.
  const STOP_WORDS = new Set([
    "The", "This", "That", "These", "Those", "There", "Here", "Then", "Thus", "Hence",
    "We", "Our", "Ours", "You", "Your", "They", "Their", "His", "Her", "Its", "It",
    "In", "On", "At", "For", "With", "From", "Into", "Over", "Under", "About", "As",
    "However", "Moreover", "Furthermore", "Finally", "First", "Second", "Third",
    "While", "When", "Where", "Although", "Because", "Since", "Given", "Note",
    "Figure", "Figures", "Table", "Tables", "Section", "Sections", "Equation", "Equations",
    "Appendix", "Appendices", "Algorithm", "Algorithms", "Theorem", "Theorems",
    "Lemma", "Corollary", "Proof", "Definition", "Remark", "Proposition",
    "Chapter", "Page", "Part", "Step", "Case", "Example", "Problem",
    "English", "Chinese", "Abstract", "Introduction", "Conclusion", "Conclusions",
    "References", "Related", "Background", "Method", "Methods", "Results",
    "Discussion", "Acknowledgments", "Acknowledgements", "Experiments",
    "University", "Institute", "Department", "Conference", "Journal", "Press",
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
    "Eq", "Fig", "Tab", "Sec", "Et", "Al",
    // Figure-caption position words and LaTeXML artifacts.
    "Left", "Right", "Top", "Bottom", "Center", "Middle", "LABEL",
    // Greek letter names leak out of math annotations on MathJax/LaTeXML pages.
    "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Theta", "Lambda",
    "Sigma", "Omega", "Phi", "Psi", "Pi", "Tau", "Eta", "Mu", "Nu", "Xi"
  ]);

  function isStopWord(token) {
    if (STOP_WORDS.has(token)) return true;
    // Catch all-caps heading forms like "ABSTRACT".
    const capitalized = token[0] + token.slice(1).toLowerCase();
    return STOP_WORDS.has(capitalized);
  }

  // One entry per line: "Arctic" keeps the term as-is, "attention=注意力"
  // forces a fixed translation. Lines starting with # are comments.
  function parseUserGlossary(raw) {
    return String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator > 0) {
          return {
            term: line.slice(0, separator).trim(),
            translation: line.slice(separator + 1).trim()
          };
        }
        return { term: line, translation: "" };
      })
      .filter((entry) => entry.term);
  }

  // Finds likely proper nouns: acronyms (BERT), mixed-case names (RoBERTa),
  // versioned names (GPT-4), and capitalized words that recur mid-sentence
  // while never appearing in lowercase (Arctic the model vs arctic the
  // adjective).
  function extractTerms(texts, options) {
    const maxTerms = (options && options.maxTerms) || 24;
    const strongCounts = new Map();
    const capitalizedMidSentence = new Map();
    const lowercaseSeen = new Set();

    const tokenPattern = /[A-Za-z][A-Za-z0-9_+./-]*/g;

    for (const raw of texts) {
      // Collapse whitespace first: HTML/PDF text is full of line wraps, and
      // the sentence-position check below looks at the preceding characters.
      const text = String(raw || "").replace(/\s+/g, " ");
      let match;
      tokenPattern.lastIndex = 0;
      while ((match = tokenPattern.exec(text))) {
        const token = match[0].replace(/[./-]+$/, "");
        if (token.length < 2 || token.length > 30) continue;

        if (/^[a-z]/.test(token)) {
          lowercaseSeen.add(token.toLowerCase());
          continue;
        }

        if (isStopWord(token)) continue;

        const isAcronym = /^[A-Z][A-Z0-9_+./-]+$/.test(token);
        const isMixedCase = /[a-z]/.test(token) && /[A-Z0-9]/.test(token.slice(1));
        const hasDigit = /\d/.test(token);

        if (isAcronym || isMixedCase || hasDigit) {
          strongCounts.set(token, (strongCounts.get(token) || 0) + 1);
          continue;
        }

        // Plain capitalized word: only meaningful when not at sentence start.
        const before = text.slice(Math.max(0, match.index - 2), match.index).trim();
        const sentenceInitial = !before || /[.!?:;]$/.test(before);
        if (!sentenceInitial) {
          capitalizedMidSentence.set(token, (capitalizedMidSentence.get(token) || 0) + 1);
        }
      }
    }

    const candidates = [];
    strongCounts.forEach((count, term) => {
      if (count >= 2) candidates.push({ term, count });
    });
    capitalizedMidSentence.forEach((count, term) => {
      if (count >= 3 && !lowercaseSeen.has(term.toLowerCase())) {
        candidates.push({ term, count });
      }
    });

    candidates.sort((a, b) => b.count - a.count);
    return candidates.slice(0, maxTerms).map((entry) => entry.term);
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // A capitalized glossary term ("Attention") collides with the ordinary word
  // when the document also uses it in lowercase: at a sentence start the
  // ordinary word is capitalized too and the two are indistinguishable by
  // string matching. Mark such entries so masking skips sentence-initial
  // occurrences and leaves the call to the model.
  function annotateAmbiguousEntries(entries, texts) {
    const joined = texts.join("\n");
    for (const entry of entries) {
      if (!/^[A-Z][a-z]+$/.test(entry.term)) continue;
      const lowercase = new RegExp(`\\b${escapeRegExp(entry.term.toLowerCase())}\\b`);
      entry.skipSentenceInitial = lowercase.test(joined);
    }
    return entries;
  }

  function isSentenceInitial(text, offset) {
    let index = offset - 1;
    while (index >= 0 && /\s/.test(text[index])) index -= 1;
    if (index < 0) return true;
    return ".!?:;".includes(text[index]);
  }

  // Replaces glossary terms with placeholder tokens so any translation API
  // (LLM or plain MT) returns them untouched; tokens are restored afterwards
  // as the term itself or its fixed translation. One token per term,
  // case-sensitive whole-word matches. Entries flagged skipSentenceInitial
  // keep their sentence-initial occurrences unmasked (could be the ordinary
  // word, not the term).
  function maskTerms(text, entries, placeholders) {
    let result = text;
    for (const entry of entries) {
      if (!entry.term) continue;
      const pattern = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, "g");
      const token = `[[PT_PH_${placeholders.length}]]`;
      let used = false;

      result = result.replace(pattern, (match, offset, current) => {
        if (entry.skipSentenceInitial && isSentenceInitial(current, offset)) {
          return match;
        }
        used = true;
        return token;
      });

      if (used) {
        placeholders.push({ token, text: entry.translation || entry.term });
      }
    }
    return result;
  }

  global.PaperTranslatorGlossary = {
    parseUserGlossary,
    extractTerms,
    annotateAmbiguousEntries,
    maskTerms
  };
})(globalThis);
