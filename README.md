# 通用翻译器 (General Web Translator)

Chrome MV3 浏览器扩展：把**任意网页**和**学术论文**（arXiv HTML、PDF、OpenReview、ACL Anthology 等）翻译成中文，同时保留公式、图表、代码、表格和引用链接。

> 项目最初是 arXiv 论文翻译器（仓库名仍为 `paper-translator`），后扩展为通用网页翻译器：支持新闻站、FAQ 折叠、目录、iframe 内嵌模块，以及在任意站点按需翻译。代码内部仍沿用 `PaperTranslator*` 命名空间与 `paperTranslator.*` 存储键以保持向后兼容。

## Features

- **双语对照（默认）**：译文显示在每段原文下方，原文 DOM 不被破坏，链接、公式、引用全部保留。
- **仅译文模式**：段落直接替换为译文，点击段落在原文/译文之间切换（切回原文时格式无损）。
- **滚动翻译**：滚动到哪里翻译到哪里（IntersectionObserver 提前 900px 预取）。
- **鼠标悬停高亮**：悬停任意段落有高亮反馈；翻译中/失败的段落有独立的状态样式。
- **失败重试**：点击红色失败段落单独重试，或点击右下角状态气泡重试全部失败段落。
- **任意网页翻译**：内容脚本以 `<all_urls>` 注入但默认只在规则匹配的页面激活；不匹配的页面可在 popup 点"翻译此网页"临时翻译（`ACTIVATE_PAGE` 消息唤醒），或点"✚ 始终翻译 <域名>"把当前站点加入规则永久生效（无需手动编辑网址规则）。
- **iframe 内容**：`all_frames` 注入，嵌在 `<iframe>` 里的模块（如 NYTimes 的订阅/结账模块）也能翻译；状态栏和 PDF 入口只在顶层显示（`inTopFrame` 判定），子框架静默翻译，`ACTIVATE_PAGE` 广播到所有框架但仅顶层回包。
- **PDF 翻译阅读器**：基于 PDF.js 的左右对照阅读器——左侧原版 PDF 逐页渲染（公式、图表、版式无损），右侧按段落提取的译文；滚动到哪页翻译到哪页，悬停译文段落时在左侧高亮对应区域，点击译文查看原文，"翻译整篇"一键全文。入口：论文页 PDF 链接旁的"翻译 PDF"，或当前标签页是 PDF 时 popup 中的"翻译当前 PDF"。
- **公式/图片/代码/表格保护**：以 `[[PT_PH_n]]` 占位符送翻译，译文中原样还原；MathJax/KaTeX/LaTeXML 元素、链接、章节编号（`.ltx_tag`）整体保留。
- **标题白名单**：只翻译结构性标题（章节/小节/摘要）；定理、证明、`\paragraph` 这类行内/微型标签（`ltx_runin`、`ltx_title_theorem`、`ltx_title_paragraph`）跳过，避免正文中出现多余的小标题行。标题译文自动去掉结尾句号（"Abstract." → "摘要" 而非 "摘要。"）。
- **叶子 div 检测**：没有块级子元素但含足量英文的裸 `div`/`dd`（OpenReview/acmart 的关键词列表等）也会被识别为可翻译块（`div:not(:has(...))`）；作者/日期行（`.ltx_authors` 等，人名不该音译）和 LaTeXML 算法清单（`.ltx_listing*`，符号汤）明确排除。
- **链接型标题**：整条标题本身是 `<a href>` 的新闻站很常见。`a[href]` 仅在文本较短（≤16 字符，引用/交叉引用如 `[1]`、`Figure 3`）时作占位符保留；更长的链接被视为正文，descend 进去翻译其文字（`shouldPreserveElement`）。学术论文的短引用仍保留可点。
- **通用网页覆盖**：候选选择器除 `article`/`main` 下的标题外，还包含裸 `h1`–`h4`、`p`、`li`、`dd`，覆盖新闻站等非论文结构；导航/页眉/页脚/侧栏（`nav`/`header`/`footer`/`aside`）仍由 skip 祖先过滤。
- **FAQ / 折叠按钮**：`<button>`/`<summary>` 不再无脑跳过——只翻译"内容型"触发器（文本 ≥35 字符，或以 `?` 结尾的问句），短 UI 按钮（"Save"、"Continue to checkout"）仍跳过。折叠面板里的答案在展开（display 由 none→block）进入视口时由 IntersectionObserver 自动翻译。
- **目录（TOC）**：文档目录常在 `nav`/`aside` 侧栏（默认跳过）。识别 `[role=doc-toc]`、`nav[aria-label*=contents]`、`.toc`、`.table-of-contents` 等容器后放行其内容并按结构性标题（低字数门槛）翻译；其中的 `<li><a>` / 直接 `<a>` 条目都覆盖（长链接不再被 `a[href]` 保留规则当作内联占位符跳过）。真实导航菜单仍跳过。
- **术语一致性**（`src/shared/glossary.js`）：三层机制保证 "Arctic" 这类名字不会一会保留一会变成"北极"——
  1. 每个请求携带论文标题作为上下文；
  2. 自动识别专有名词（缩写词、混合大小写、带数字的名字，以及"句中大写且全文从不以小写出现"的词，如模型名、作者名），写入提示词要求保留英文；HTML 页在初扫完成后计算一次并冻结，PDF 取元数据标题+前 3 页；
  3. 用户术语表（设置页，每行 `Arctic` 保留原文或 `attention=注意力` 固定译法）——发送前替换为占位符、译文中还原，对 simple/openai 两种 API 模式都是 100% 确定的。
  缓存键包含论文标题和用户术语表，修改术语表后旧缓存自动失效。
  大小写冲突的处理（术语 `Attention` vs 普通词 attention）：匹配区分大小写，小写普通词不受大写术语影响；
  自动识别在发现小写形式并存时主动放弃；句首的大写歧义词不做掩码，
  改为在提示词中说明该词两种用法并存，由模型按语境判断（`annotateAmbiguousEntries`）。
- **上下文增强翻译**（默认开启，设置页可关）：每段请求附带**上一段原文**（`[CONTEXT]`/`[TRANSLATE]` 结构，注明仅供理解），
  解决段首指代（"It / This approach"）和跨段措辞一致性。用上一段原文而非译文，因此不依赖翻译顺序、并发管线不变；
  HTML 端按扫描顺序成链，PDF 端段落链跨页衔接。token 消耗约翻倍；仅 openai-compatible 模式生效；
  contextBefore 不参与缓存键（换上下文时复用已有译文）。**上下文嵌入前会剥掉其中的 `[[PT_PH_n]]` 占位符**——
  否则模型可能把上一段的占位符抄进本段译文，而本段没有对应条目，会漏出字面 `[[PT_PH_0]]`（v0.6.1 修复）。
  渲染层兜底：找不到对应占位符的杂散 token 直接丢弃而非显示字面文本。
- **本地缓存**：同一段文本不重复请求。

## Performance Notes

为了避免长论文页面卡顿，内容脚本遵守以下规则：

- 扫描阶段只做选择器匹配和 `textContent` 检查，**不读取任何计算样式**（`getComputedStyle` / `getBoundingClientRect` 会强制重排）。
- 占位符序列化推迟到段落真正进入翻译队列时才执行。
- 初始扫描分块进行（每块 250 个元素，`requestIdleCallback` 调度），首块同步以便首屏立即开始翻译。
- 每段一条请求、多路并发（默认 4），译文逐段渲染，不存在批次队头阻塞。
- MutationObserver 回调只收集节点，过滤和扫描在 350ms 去抖之后进行；大量变更时退化为一次幂等的整页重扫。

## Local Testing Without An API

`test/harness.html` 和 `test/harness-large.html` 在普通网页里 stub 了 `chrome.*` API 和一个假翻译接口，
用任意静态服务器（例如 `python -m http.server --directory D:\translator`）打开即可调试内容脚本：

- `harness.html`：双语/替换两种模式（`?mode=replace`）、占位符保留、错误重试、链接点击放行。
- `harness-large.html`：3000 段大页面，配合 PerformanceObserver（`__longTasks`）检查主线程卡顿。
- `pdf-harness.html?src=/test/real-paper.pdf`：PDF 阅读器（单栏 Mamba 论文）；`?src=/test/two-column.pdf` 为双栏 BERT 论文，验证分栏阅读顺序和段落切分。
- `node test/glossary.test.js`：术语提取/掩码的单元测试。页面里可通过 `__paperTranslatorContext`（标题+自动术语）和 `__sentPayloads`（发送的请求）检查术语链路。
- 纯 Node 单测（无需下载论文）：`node test/glossary.test.js`、`node test/pdfText.test.js`、`node test/translatorClient.test.js`。

PDF 测试用的真实论文（`test/*.pdf`、`test/real-paper.html`）是第三方版权论文，**未纳入 Git**。需要时自行下载：

```sh
curl -L https://arxiv.org/pdf/2312.00752v2 -o test/real-paper.pdf   # Mamba（单栏）
curl -L https://arxiv.org/pdf/1810.04805v2 -o test/two-column.pdf   # BERT（双栏）
curl -L https://arxiv.org/html/2312.00752v2 -o test/real-paper.html # Mamba HTML
```

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this folder: `D:\translator`.

## 分发与上架

运行 `powershell -ExecutionPolicy Bypass -File pack.ps1` 生成 `dist\paper-translator-<版本>.zip`
（自动排除 `test\` 测试论文——那些 PDF 不可再分发；zip 条目使用正斜杠，符合商店要求）。

**发给同学（免上架）**：把 zip 发过去，对方解压后在 `chrome://extensions` 开启"开发者模式"→"加载已解压的扩展程序"选中解压目录即可。
注意：① 每人需在设置页配置自己的 API Endpoint/Key；② 直接发 `.crx` 在普通 Windows Chrome 上会被拦截，不要走那条路；③ 更新靠重新发 zip。

**上架 Chrome Web Store**：
1. 注册开发者账号（一次性 $5）：https://chrome.google.com/webstore/devconsole
2. 上传 zip，填写商店信息：名称/描述、至少 1 张 1280×800 截图、128px 图标（`assets/icons/icon128.png`）。
3. 隐私声明：必须提供隐私政策链接（可用 GitHub README），如实说明"页面文本会发送到**用户自行配置**的翻译 API，插件本身不收集任何数据，API Key 仅存于本地 storage"。
4. 权限说明：`host_permissions: <all_urls>` 会触发更严的人工审核，需在"权限理由"栏解释（用户可自定义任意论文站点的网址规则 + API 端点域名不可预知）。审核通常几个工作日。
5. 上架后用户自动更新，发新版只需改 `manifest.json` 的 `version` 再传新 zip。

也可以同时上架 Microsoft Edge 加载项商店（注册免费，同一个 zip 直接传）。

## Configure The API

Open the extension options page and fill:

- `API Mode`
- `API Endpoint`
- `API Key`
- `Model`, only needed for `openai-compatible`
- 译文显示方式（双语对照 / 仅译文）
- URL rules

### simple mode

The extension sends:

```json
{
  "text": "The source paragraph.",
  "source_lang": "en",
  "target_lang": "zh-CN",
  "targetLanguage": "zh-CN"
}
```

It accepts any of these response shapes:

```json
{ "translatedText": "译文" }
{ "translation": "译文" }
{ "text": "译文" }
{ "result": "译文" }
{ "data": { "translation": "译文" } }
```

Plain text responses are also accepted.

### openai-compatible mode

The extension sends a Chat Completions style request; the target language in the
system prompt follows the configured `targetLanguage`. The response is read from
`choices[0].message.content`.

## PDF Reader Internals

- PDF.js（`vendor/pdfjs/`，pdfjs-dist 4.10.38，文件改名为 `.js` 以兼容简易静态服务器的 MIME 判断）。
- 段落重建：`src/pdf/pdfTranslator.js` 把 `getTextContent()` 的定位碎片按基线合并成行，再按"垂直间距 / 字号突变（比较相邻行）/ 跨栏跳变 / 句末缩进 / 编号标题前后强制分段"聚合成段；连字符断词自动拼回；旋转文本（arXiv 水印）、页眉页脚、页码被过滤。
- 公式行、表格单元格、坐标轴标签等提取出来是符号乱码，按字母占比过滤后不送翻译（左侧原版页面本来就可读）。
- 段落内的行内公式（Unicode 数学区段字符：𝑨𝑥、希腊字母、←∈ℝ 等，含 `= ( )` 等胶水符号）以占位符送翻译、译文中原样还原（`maskMathRuns`）——API 不接触公式本体，不会乱改符号，也不浪费 token；单元测试 `node test/pdfText.test.js`。
- canvas 按需渲染并设上限（12 页），远处页面降级为占位符防止内存膨胀。
- 阅读器页面通过 `web_accessible_resources` 暴露，论文页中的"翻译 PDF"链接才能直接打开。

## License & Credits

本项目以 [MIT License](LICENSE) 开源。捆绑的 [PDF.js](https://mozilla.github.io/pdf.js/)（`vendor/pdfjs/`）由 Mozilla 以 Apache-2.0 许可发布，版权归其作者所有。

## Notes

API keys stored in a browser extension are not secret. This is acceptable for personal use, but a public extension should use a backend proxy.
