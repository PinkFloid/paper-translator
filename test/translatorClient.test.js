// Run with: node test/translatorClient.test.js
require("../src/background/translatorClient.js");
const { __test } = globalThis.PaperTranslatorClient;

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}`);
  }
}

const config = { apiMode: "openai-compatible", model: "x", targetLanguage: "zh-CN" };

// Context placeholders must be stripped so the model cannot echo a previous
// block's [[PT_PH_n]] into this translation.
{
  const body = __test.buildOpenAiBody(
    config,
    "We introduce [[PT_PH_0]] for this task.",
    { title: "A Paper", terms: [] },
    "Prior work used cameras [[PT_PH_0]] and sensors [[PT_PH_1]]."
  );
  const user = body.messages[1].content;
  check("context section present", user.includes("[CONTEXT]") && user.includes("[TRANSLATE]"));
  check("translate section keeps its own token", user.includes("We introduce [[PT_PH_0]] for this task."));
  const contextPart = user.slice(user.indexOf("[CONTEXT]"), user.indexOf("[TRANSLATE]"));
  check("context has no placeholder tokens", !/\[\[PT_PH_\d+\]\]/.test(contextPart));
  check("context text otherwise preserved", contextPart.includes("Prior work used cameras") && contextPart.includes("and sensors"));
}

// No context → plain text, no [CONTEXT] wrapper.
{
  const body = __test.buildOpenAiBody(config, "Plain text [[PT_PH_0]].", { title: "", terms: [] }, "");
  check("no context wrapper when absent", body.messages[1].content === "Plain text [[PT_PH_0]].");
}

// Context that is only placeholders collapses to empty → no wrapper.
{
  const body = __test.buildOpenAiBody(config, "Cur.", { title: "", terms: [] }, "[[PT_PH_0]] [[PT_PH_1]]");
  check("all-placeholder context dropped", body.messages[1].content === "Cur.");
}

process.exit(failures ? 1 : 0);
