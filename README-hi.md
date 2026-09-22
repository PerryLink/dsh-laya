# dsh-laya

[Laya](https://github.com/NandhaKishorM/laya) के टाइप किए निर्णय — `noul` (हाँ/नहीं), `choice`, `score` — [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) के लिए प्रथम-श्रेणी की Cordis सेवा और मॉडल को दिखने वाले उपकरणों के रूप में।

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

> **स्थिति: 0.1.4, निर्माणाधीन।** यह plugin Harness में माउंट और सक्रिय होता है, और जो sidecar अनुबंध यह बोलता है वह RTX 5060 पर अंत-से-अंत सत्यापित है (लोड 9.8 सेकंड, CUDA पर तीन प्रश्नों के लिए 411 मिलीसेकंड)। इसे CI में किसी वास्तविक मॉडल-टर्न से नहीं गुज़ारा गया है।

---

## स्थापना

दो हिस्से, क्योंकि Laya PyTorch है और इसलिए किसी Node plugin के भीतर नहीं रह सकता।

**1. sidecar** — यही वास्तव में मॉडल रखता है:

```bash
pip install "laya-mcp[mcp]"
laya-mcp serve                      # एक बार लोड, 127.0.0.1:8787 पर सुनता है
```

**2. यह plugin:**

```bash
dsh plugin --profile <profile> add dsh-laya
```

फिर पुष्टि करें कि पंक्ति `active` है, `failed` नहीं, और शुरुआती पंक्ति पढ़ें — वह साफ़ शब्दों में बताती है कि state इसी मशीन पर रहता है या नहीं।

## sidecar अलग क्यों है

जो plugin चुपचाप `pip install` चलाकर 650 MB का checkpoint डाउनलोड कर ले, वह कितना भी सुविधाजनक हो, शत्रुतापूर्ण है। इसलिए यह plugin **कुछ भी स्थापित नहीं करता और कुछ भी डाउनलोड नहीं करता**। यह उस प्रक्रिया का क्लाइंट है जिसे आप शुरू करते हैं, और जब वह प्रक्रिया नहीं चल रही होती तो यह बता देता है, बजाय पहली tool call पर अस्पष्ट रूप से विफल होने के।

यह विभाजन गर्म मॉडल भी देता है: Laya का ठंडा निर्माण कुछ सेकंड से दसियों सेकंड तक लेता है, और उसका डिफ़ॉल्ट आलसी router हर भाषा-परिवर्तन पर checkpoint दोबारा बनाता है। `laya-mcp serve` यह कीमत एक बार चुकाता है।

## यह क्या देता है

**एक सेवा, `ctx.laya`** — ताकि Host कोड और अन्य plugins सीधे निर्णय माँग सकें, बिना मॉडल तक एक चक्कर के:

```js
const laya = ctx.get('laya')
const result = await laya.ask({ state, questions })
```

यह `ask`, `plan`, `health`, `capabilities`, `sidecarUrl` और `loopback` देता है — अंतिम यह कि state इसी मशीन पर रहता है, एक तथ्य के रूप में, नीति के रूप में नहीं। `plan` वह preflight है: वही गणित जो `/ask` रिपोर्ट करता है, बिना forward pass।

**दो उपकरण** — `laya_ask` टाइप किए प्रश्नों के समूह के लिए, और `laya_plan` forward pass खर्च करने से पहले टोकन बजट जाँचने के लिए।

## यह किन बातों में ईमानदार है

Laya चुपचाप काटता है और उसका confidence अंक व्यापक रूप से गलत पढ़ा जाता है, इसलिए उपकरण का विवरण और उत्तर — दोनों यह बताते हैं:

- **बहुत बड़ा state अंत से काटा जाता है**, और उत्तर फिर बचे हुए अग्रभाग के बारे में होता है। उत्तर इसे `truncated` में रिपोर्ट करता है, और `laya_plan` पूछने से पहले ही बता देता है। मना करने के लिए `strict: true` भेजें — चल रहे sidecar के विरुद्ध सत्यापित, जो HTTP 400, `state_truncated` और `max_len` का नाम लेने वाला संकेत लौटाता है।
- **`confidence` सटीकता नहीं है।** यह एक संकेंद्रण सांख्यिकी है: जब प्रायिकता विकल्पों में बिखरी हो तो कम — भले शीर्ष विकल्प सही हो; और आत्मविश्वास से गलत उत्तर पर ज़्यादा। `noul` के साथ `no` / `uncertain` / `yes` बैंड भी आता है, क्योंकि अंशशोधित प्रायिकता निर्णय नहीं होती — इस स्टैक से एक वास्तविक मापा उदाहरण 0.5457 लौटाया, बैंड `uncertain`।
- **चुपचाप हुई CPU अवनति की रिपोर्ट होती है।** यदि डिवाइस त्रुटि के बाद Laya CPU पर गिर जाए तो वह कभी accelerator पर नहीं लौटता, और उसके अपने आउटपुट में कुछ भी इसे स्वीकार नहीं करता। स्वास्थ्य सतह `degraded` रखती है, और उपकरण कार्ड `CPU (degraded)` जोड़ देता है।

## कॉन्फ़िगरेशन

```yaml
- insert:
    - id: laya
      name: 'dsh-laya'
      config:
        sidecarUrl: 'http://127.0.0.1:8787'
        requestTimeoutMs: 120000
        lifecycle: never      # 'attach' एक पहुँच-जाँच लॉग करता है,
                              # 'spawn' स्वयं sidecar शुरू करता है
        spawnCommand: null    # 'spawn' के लिए आवश्यक, जैसे ['laya-mcp', 'serve']
        spawnTimeoutMs: 120000
        logLevel: info
```

`lifecycle` तय करता है कि जब `sidecarUrl` पर कोई उत्तर न दे तो क्या हो:

| | |
|---|---|
| `never` | कुछ शुरू न करें; मान लें कि कोई और sidecar सँभाल रहा है। डिफ़ॉल्ट। |
| `attach` | लोड पर एक बार `/health` भी जाँचें और जो मिला वह लॉग करें — जब harness और sidecar शुरुआत में होड़ करें तब उपयोगी। |
| `spawn` | यदि कोई उत्तर न दे तो `spawnCommand` भी चलाएँ, फिर उसके आने की प्रतीक्षा करें। |

`spawn` इसलिए है क्योंकि विकल्प बदतर था। यह plugin अब भी कुछ स्थापित नहीं करता और कुछ डाउनलोड नहीं करता — जो उपकरण चुपचाप `pip install` चलाकर 650 MB checkpoint ले आए वह शत्रुतापूर्ण होगा, और यह नहीं बदला। परंतु *जो sidecar आप पहले ही स्थापित कर चुके हैं उसे चलाना* अलग कार्य है, और उसके बिना हर सत्र टर्मिनल में हाथ से एक Python प्रक्रिया शुरू करके आरंभ होता था, और वह प्रक्रिया जाते ही फिर विफल होने लगता था।

दो नियम इसे चालू छोड़ना सुरक्षित बनाते हैं:

* जो sidecar पहले से उत्तर दे रहा है, उससे **केवल जुड़ा जाता है, उसे कभी छुआ नहीं जाता**, इसलिए दो harness सत्र एक ही पोर्ट पर दो मॉडल नहीं रख सकते।
* इस plugin ने जो sidecar शुरू किया वह **plugin अनमाउंट होने पर रोक दिया जाता है**; जो इसने शुरू नहीं किया वह ठीक वैसा ही छोड़ा जाता है जैसा मिला था।

अब भी कोई ऐसा विकल्प नहीं जो कुछ स्थापित करे या मॉडल ले आए, और `spawnCommand` का कोई डिफ़ॉल्ट नहीं: यह plugin interpreter का अनुमान नहीं लगाएगा।

`sidecarUrl` को loopback के अलावा कहीं इंगित करना अनुमत है और शुरुआत में एक बार चेतावनी देता है, गंतव्य का नाम लेकर: वही क्षण है जब निजता की कहानी बदलती है, और वह केवल कॉन्फ़िग फ़ाइल पढ़कर पता नहीं चलना चाहिए।

## इस पर निर्भर होने से पहले जानने योग्य अपस्ट्रीम सीमाएँ

अपस्ट्रीम के स्वयं के मापन दोहराए गए हैं, क्योंकि जो एकीकरण इसके विपरीत संकेत देता है वह आपसे झूठ बोल रहा है। आधार checkpoints टाइप किए निर्णयों पर **zero-shot में संयोग के क़रीब** हैं (अंग्रेज़ी के लिए 0.362, बहुसंख्यक-वर्ग आधार रेखा 0.461 के विरुद्ध); `score` सबसे कमज़ोर primitive है (स्वतंत्र मापन में 35%, Jev के 70% के विरुद्ध); तापमान फ़िट करने से पहले कच्ची अंशशोधन त्रुटि 0.466 है; और लगभग 20 विकल्पों से ऊपर सटीकता गिरती है।

अंशशोधन प्रायिकता को ईमानदार बनाता है। यह मॉडल को सही नहीं बना सकता।

**लागू DSH संस्करण:** `dsh-v0.1.7-alpha.1` (यह बिल्ड जिस होस्ट रिलीज़ को लक्षित करता है) पर सत्यापित; आवश्यक `>=0.1.7-alpha.1 <0.2.0`।

## PerryLink DSH Plugin Family

This project is one of the **45 DeepSeek Harness plugins** maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default | |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command | |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | |
| **[dsh-catalog](https://github.com/PerryLink/dsh-catalog)** | DSH Desktop Market standard catalog source for the PerryLink family | |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence | |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore | |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. | |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search | |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) | |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review | |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. | |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds | |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval | |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` | |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools | |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. | |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. | |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers | |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer | |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors | |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool | |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. | |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching | |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit | |
| **[dsh-plugin-certification](https://github.com/PerryLink/dsh-plugin-certification)** | Community certification registry with repro-checkable grades and badges | |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins | |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill | |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins | |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card | |
| **[dsh-plugin-upgrade-015](https://github.com/PerryLink/dsh-plugin-upgrade-015)** | Merged `0.1.3-alpha.1` → `0.1.5-rc.1` upgrade corridor card plus a zero-dependency seam scanner | |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions | |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. | |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. | |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review | |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. | |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. | |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools | |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. | |


## लाइसेंस

Apache-2.0। Laya, Convai Innovations द्वारा Apache-2.0 के अंतर्गत है। यह एक स्वतंत्र एकीकरण है और उस प्रोजेक्ट से संबद्ध या उससे अनुमोदित नहीं है।
