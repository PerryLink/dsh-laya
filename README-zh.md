# dsh-laya

[Laya](https://github.com/NandhaKishorM/laya) 的有类型决策——`noul`（是/否）、`choice`、`score`——作为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的一等 Cordis 服务与模型可见工具。

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

> **状态：0.1.4，开发中。** 插件在 Harness 中能挂载并激活，它所说的 sidecar 契约已在 RTX 5060 上端到端验证（加载 9.8 秒，CUDA 上三个问题 411 毫秒）。尚未在 CI 中经过真实模型回合的检验。

---

## 安装

两块，因为 Laya 是 PyTorch，无法住在一个 Node 插件里。

**1. sidecar**——真正持有模型的那部分：

```bash
pip install "laya-mcp[mcp]"
laya-mcp serve                      # 加载一次，监听 127.0.0.1:8787
```

**2. 本插件：**

```bash
dsh plugin --profile <profile> add dsh-laya
```

然后确认该行是 `active` 而不是 `failed`，并读启动行——它会明说 state 是否留在这台机器上。

## 为什么 sidecar 是分开的

一个偷偷 `pip install` 再下载 650 MB checkpoint 的插件，无论多方便都是充满敌意的。所以本插件**什么都不安装、什么都不下载**。它是你所启动进程的客户端；当那个进程没在跑时它会说出来，而不是在第一次工具调用时晦涩地失败。

这个拆分也换来了常驻模型：Laya 的冷构建要几秒到几十秒，而它默认的惰性 router 会在每次语言切换时重建 checkpoint。`laya-mcp serve` 只付一次这个代价。

## 它贡献什么

**一个服务，`ctx.laya`**——于是 Host 代码和其它插件可以直接请求判断，不必绕一趟模型：

```js
const laya = ctx.get('laya')
const result = await laya.ask({ state, questions })
```

它暴露 `ask`、`plan`、`health`、`capabilities`、`sidecarUrl` 和 `loopback`——最后一个是 state 是否留在这台机器上，是事实而非策略。`plan` 是预检：与 `/ask` 报告的同一套算术，不跑前向传播。

**两个工具**——`laya_ask` 用于一批有类型问题，`laya_plan` 用于在花掉一次前向传播之前检查 token 预算。

## 它诚实在什么地方

Laya 会静默截断，它的 confidence 数字被广泛误读，所以工具描述与响应都会说明：

- **过大的 state 会从末尾被切掉**，答案随后是关于残存前缀的。响应在 `truncated` 下报告它，`laya_plan` 在你发问之前就告诉你。传 `strict: true` 改为拒绝——已对着活 sidecar 验证，它会返回 HTTP 400、`state_truncated` 以及一条指出 `max_len` 的 hint。
- **`confidence` 不是准确率。** 它是一个集中度统计量：概率铺在多个选项上时低——即使首选选项是对的；自信地答错时高。`noul` 还带一个 `no` / `uncertain` / `yes` 分带，因为标定过的概率不是决策——本栈的一个真实测量例子返回 0.5457、分带为 `uncertain`。
- **静默的 CPU 降级会被报告。** 如果 Laya 在设备错误后回落到 CPU，它就再也不会回到加速器，而它自己的输出里没有任何东西承认这一点。健康面带 `degraded`，工具卡片追加 `CPU (degraded)`。

## 配置

```yaml
- insert:
    - id: laya
      name: 'dsh-laya'
      config:
        sidecarUrl: 'http://127.0.0.1:8787'
        requestTimeoutMs: 120000
        lifecycle: never      # 'attach' 打一条可达性日志，
                              # 'spawn' 自己把 sidecar 起起来
        spawnCommand: null    # 'spawn' 必填，例如 ['laya-mcp', 'serve']
        spawnTimeoutMs: 120000
        logLevel: info
```

`lifecycle` 决定当 `sidecarUrl` 上无人应答时做什么：

| | |
|---|---|
| `never` | 什么都不起；假定别的东西在管 sidecar。默认值。 |
| `attach` | 加载时额外查一次 `/health` 并把结果记进日志——在 harness 与 sidecar 启动竞速时有用。 |
| `spawn` | 如果无人应答就运行 `spawnCommand`，然后等它起来。 |

`spawn` 存在是因为替代方案更糟。插件仍然什么都不安装、什么都不下载——一个偷偷 `pip install` 再取回 650 MB checkpoint 的工具是充满敌意的，这一点没有变。但*启动一个你已经装好的 sidecar* 是另一回事；没有它，每个会话都要先在终端里手动起一个 Python 进程，而那个进程一消失就又开始失败。

两条规则让它能安全地常开：

* **已经在应答的 sidecar 只连接、绝不触碰**，所以两个 harness 会话不会在同一端口上放两个模型。
* **本插件启动的 sidecar 会在插件卸载时被停止**；不是它启动的，则原样留在被找到时的状态。

仍然没有任何会安装东西或取回模型的选项，而且 `spawnCommand` 没有默认值：本插件不会去猜解释器。

把 `sidecarUrl` 指向非回环地址是允许的，启动时会警告一次并说出目的地：那是隐私故事改变的时刻，不该只能通过读配置文件才发现。

## 依赖它之前值得知道的上游限制

重复上游自己的测量，因为一个暗示相反的集成层是在骗你。基础 checkpoint 在有类型决策上**零样本接近随机**（英文 0.362，对 0.461 的多数类基线）；`score` 是最弱的 primitive（独立测量 35%，对比 Jev 的 70%）；原始标定误差在拟合温度前是 0.466；准确率在约 20 个选项以上下滑。

标定让概率诚实。它不能让模型正确。

**适用的 DSH 版本：** 已在 `dsh-v0.1.7-alpha.1`（本构建所针对的宿主版本）上验证；要求 `>=0.1.7-alpha.1 <0.2.0`。

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


## 许可证

Apache-2.0。Laya 由 Convai Innovations 以 Apache-2.0 发布。这是一个独立集成，与该上游项目无关联，也未获其背书。
