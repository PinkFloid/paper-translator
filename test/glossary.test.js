// Run with: node test/glossary.test.js
require("../src/shared/glossary.js");
const { parseUserGlossary, extractTerms, annotateAmbiguousEntries, maskTerms } =
  globalThis.PaperTranslatorGlossary;

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  }
}

// --- parseUserGlossary ---
check(
  "parse keep + fixed + comment",
  parseUserGlossary("Arctic\nattention=注意力\n# comment\n\n  Mamba  "),
  [
    { term: "Arctic", translation: "" },
    { term: "attention", translation: "注意力" },
    { term: "Mamba", translation: "" }
  ]
);

// --- extractTerms ---
const paper = [
  "We introduce Arctic, a new embedding model. Experiments show that Arctic outperforms baselines.",
  "Compared to BERT and RoBERTa, the Arctic model uses GPT-4 style training.",
  "The selective mechanism is selective about inputs. We evaluate Arctic on GLUE.",
  "In the arctic region of the figure, see Figure 3 and Table 2 for details.",
  "However, This approach... The University of Somewhere."
];
const terms = extractTerms(paper);
check("Arctic detected (mid-sentence, no lowercase clash... wait there IS lowercase arctic)", terms.includes("Arctic"), false);

const paper2 = [
  "We introduce Arctic, a new embedding model. Experiments show that Arctic outperforms baselines.",
  "The Arctic model uses contrastive training. We evaluate Arctic on retrieval tasks."
];
const terms2 = extractTerms(paper2);
check("Arctic detected when no lowercase form exists", terms2.includes("Arctic"), true);
check("acronym BERT detected", extractTerms(["BERT is great. BERT wins."]).includes("BERT"), true);
check("mixed-case RoBERTa detected", extractTerms(["RoBERTa improves on this. RoBERTa again."]).includes("RoBERTa"), true);
check("GPT-4 detected", extractTerms(["GPT-4 performs well. GPT-4 is large."]).includes("GPT-4"), true);
check("Figure not a term", extractTerms(["see Figure 1. see Figure 2. see Figure 3. and Figure 4."]).includes("Figure"), false);
check("line wraps do not hide mid-sentence position",
  extractTerms(["the\n   Borealis system, and\n   Borealis remains, running\n   Borealis daily"]).includes("Borealis"),
  true);
check("ABSTRACT stopword via case fold", extractTerms(["ABSTRACT here. ABSTRACT again."]).includes("ABSTRACT"), false);

// --- maskTerms ---
const placeholders = [{ token: "[[PT_PH_0]]", html: "<img>" }];
const masked = maskTerms(
  "Arctic beats prior work; the attention module of Arctic is standard attention.",
  parseUserGlossary("Arctic\nattention=注意力"),
  placeholders
);
check("mask replaces all occurrences with shared tokens",
  masked,
  "[[PT_PH_1]] beats prior work; the [[PT_PH_2]] module of [[PT_PH_1]] is standard [[PT_PH_2]].");
check("placeholder entries appended after existing ones", placeholders.slice(1), [
  { token: "[[PT_PH_1]]", text: "Arctic" },
  { token: "[[PT_PH_2]]", text: "注意力" }
]);
check("no partial-word match", maskTerms("Antarctic is not Arctic.", parseUserGlossary("Arctic"), []), "Antarctic is not [[PT_PH_0]].");

// --- case-collision handling (term "Attention" vs ordinary "attention") ---
const collided = annotateAmbiguousEntries(
  parseUserGlossary("Attention\nMamba"),
  ["We compute attention weights. Attention outperforms Mamba on this benchmark."]
);
check("collision detected only for terms with lowercase twin",
  collided.map((e) => Boolean(e.skipSentenceInitial)),
  [true, false]);

check("ambiguous term: sentence-initial kept, mid-sentence masked",
  maskTerms("Attention is computed by softmax. We then feed Attention outputs onward.", collided, []),
  "Attention is computed by softmax. We then feed [[PT_PH_0]] outputs onward.");

check("ambiguous term at text start kept",
  maskTerms("Attention reduces overfitting here.", collided, []),
  "Attention reduces overfitting here.");

check("no placeholder entry when nothing was masked",
  (() => { const ph = []; maskTerms("Attention only at start.", collided, ph); return ph.length; })(),
  0);

check("unambiguous term still masks sentence-initial occurrences",
  maskTerms("Mamba wins. We like Mamba.", collided, []),
  "[[PT_PH_0]] wins. We like [[PT_PH_0]].");

process.exit(failures ? 1 : 0);
