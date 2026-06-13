(function (global) {
  function normalizeTranslation(text) {
    return String(text || "")
      .replace(/^```(?:text)?/i, "")
      .replace(/```$/i, "")
      .trim();
  }

  function parseSimpleResponse(data) {
    if (typeof data === "string") return data;
    if (!data || typeof data !== "object") return "";

    return (
      data.translatedText ||
      data.translation ||
      data.text ||
      data.result ||
      (data.data && (data.data.translatedText || data.data.translation || data.data.text)) ||
      ""
    );
  }

  function parseOpenAiCompatibleResponse(data) {
    const choice = data && data.choices && data.choices[0];
    return (
      (choice && choice.message && choice.message.content) ||
      (choice && choice.text) ||
      parseSimpleResponse(data)
    );
  }

  function isOpenAiCompatibleConfig(config) {
    return config.apiMode === "openai-compatible" || String(config.apiEndpoint || "").includes("/chat/completions");
  }

  async function postJson(config, body) {
    if (!config.apiEndpoint) {
      throw new Error("API endpoint is empty");
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let response;
    try {
      response = await fetch(config.apiEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("API request timed out after 45 seconds");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`API ${response.status}: ${errorText || response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    return response.text();
  }

  const LANGUAGE_LABELS = {
    "zh-cn": "Simplified Chinese",
    "zh-tw": "Traditional Chinese",
    zh: "Simplified Chinese",
    ja: "Japanese",
    ko: "Korean",
    en: "English",
    fr: "French",
    de: "German",
    es: "Spanish",
    ru: "Russian"
  };

  function languageLabel(targetLanguage) {
    const key = String(targetLanguage || "zh-CN").toLowerCase();
    return LANGUAGE_LABELS[key] || targetLanguage;
  }

  function buildOpenAiBody(config, text, context, contextBefore) {
    const lines = [
      `You translate text from an academic paper into ${languageLabel(config.targetLanguage)}.`
    ];

    if (context && context.title) {
      lines.push(`The paper is titled "${context.title}".`);
    }
    if (context && Array.isArray(context.terms) && context.terms.length > 0) {
      lines.push(
        "These tokens are proper nouns in this paper (model, system, dataset, or author names). " +
          `Always keep them in English exactly as written: ${context.terms.join(", ")}.`
      );
    }
    if (context && Array.isArray(context.ambiguousTerms) && context.ambiguousTerms.length > 0) {
      lines.push(
        `In this paper these words are proper names but can also be ordinary English words: ${context.ambiguousTerms.join(", ")}. ` +
          "Judge each remaining occurrence from context: keep name usages in English, translate ordinary usages normally."
      );
    }

    lines.push(
      "Rules:",
      "- Translate the text faithfully and in full. Never summarize, paraphrase, omit, or add content.",
      "- The text may be an incomplete sentence or fragment (e.g. cut off at a page break). Translate it as-is; do not complete or continue it.",
      "- Keep placeholder tokens like [[PT_PH_0]] exactly as they are, in the position that fits the translated sentence.",
      "- Keep LaTeX, inline math like $x$, code, URLs, and citation markers unchanged.",
      "- Keep an academic tone. Do not add explanations, notes, or quotes around the output.",
      "- Output only the translation."
    );

    let userContent = text;
    // Strip placeholder tokens from the context: they belong to the previous
    // block's numbering, and if the model echoes one into this translation we
    // would have no entry to restore it (it leaks as literal [[PT_PH_n]]).
    const cleanContext = contextBefore
      ? contextBefore.replace(/\[\[PT_PH_\d+\]\]/g, " ").replace(/\s+/g, " ").trim()
      : "";
    if (cleanContext) {
      lines.push(
        "- A [CONTEXT] section may precede the text: it is the previous paragraph, given only to resolve " +
          "references and keep terminology consistent. Never translate or repeat it, and never copy any token " +
          "from it; translate only the [TRANSLATE] section."
      );
      userContent = `[CONTEXT]\n${cleanContext}\n\n[TRANSLATE]\n${text}`;
    }

    return {
      model: config.model || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: lines.join("\n")
        },
        {
          role: "user",
          content: userContent
        }
      ]
    };
  }

  function buildSimpleBody(config, text) {
    return {
      text,
      source_lang: "en",
      target_lang: config.targetLanguage,
      targetLanguage: config.targetLanguage
    };
  }

  async function translateText(config, text, context, contextBefore) {
    const isOpenAiCompatible = isOpenAiCompatibleConfig(config);
    // Plain MT endpoints have no prompt, so contextBefore only applies to
    // the openai-compatible mode.
    const body = isOpenAiCompatible
      ? buildOpenAiBody(config, text, context, contextBefore)
      : buildSimpleBody(config, text);
    const data = await postJson(config, body);
    const parsed = isOpenAiCompatible ? parseOpenAiCompatibleResponse(data) : parseSimpleResponse(data);
    const translatedText = normalizeTranslation(parsed);

    if (!translatedText) {
      throw new Error("API response does not contain translated text");
    }

    return translatedText;
  }

  global.PaperTranslatorClient = {
    translateText,
    __test: { buildOpenAiBody }
  };
})(globalThis);
