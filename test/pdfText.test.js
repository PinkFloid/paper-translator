// Run with: node test/pdfText.test.js
require("../src/pdf/pdfTranslator.js");
const { maskMathRuns, isTranslatable } = globalThis.PaperTranslatorPdfText;

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

// Inline math run with glue tokens is masked as one placeholder.
{
  const ph = [];
  const masked = maskMathRuns("where 𝑥ₜ ∈ ℝᵈ is the input at step t.", ph);
  check("inline math run masked", masked, "where [[PT_PH_0]] is the input at step t.");
  check("run text preserved verbatim", ph[0].text, "𝑥ₜ ∈ ℝᵈ");
}

// Glue between two math tokens joins the run; plain words break it.
{
  const ph = [];
  const masked = maskMathRuns("set Δ = 𝜏 and continue with α here.", ph);
  check("glue token joins run", masked, "set [[PT_PH_0]] and continue with [[PT_PH_1]] here.");
  check("two runs recorded", ph.map((p) => p.text), ["Δ = 𝜏", "α"]);
}

// Text without math characters is untouched and adds no placeholders.
{
  const ph = [];
  const masked = maskMathRuns("plain sentence with x = 5 ascii only.", ph);
  check("ascii-only text untouched", masked, "plain sentence with x = 5 ascii only.");
  check("no placeholders for ascii", ph.length, 0);
}

// Token numbering continues after existing placeholders (glossary terms).
{
  const ph = [{ token: "[[PT_PH_0]]", text: "Arctic" }];
  const masked = maskMathRuns("uses Δ for step size.", ph);
  check("numbering continues", masked, "uses [[PT_PH_1]] for step size.");
}

// isTranslatable still rejects symbol soup.
check("symbol soup rejected", isTranslatable("𝑨 ∈ ℝ ⟶ Δ τ σ"), false);

process.exit(failures ? 1 : 0);
