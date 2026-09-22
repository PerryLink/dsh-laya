# dsh-laya

[Laya](https://github.com/NandhaKishorM/laya) typed decisions — `noul` (yes/no),
`choice`, `score` — as a first-class Cordis service and model-visible tools for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

> **Status: 0.1.3, work in progress.** The plugin mounts and activates in the
> Harness, and the sidecar contract it speaks is verified end-to-end on an RTX
> 5060 (load 9.8 s, 411 ms for three questions on CUDA). It has not yet been
> exercised through a live model turn in CI.

---

## Install

Two pieces, because Laya is PyTorch and therefore cannot live inside a Node
plugin.

**1. The sidecar** — this is what actually holds the model:

```bash
pip install "laya-mcp[mcp]"
laya-mcp serve                      # loads once, listens on 127.0.0.1:8787
```

**2. This plugin:**

```bash
dsh plugin --profile <profile> add dsh-laya
```

Then confirm the row is `active`, not `failed`, and read the startup line — it
says in as many words whether state stays on this machine.

## Why the sidecar is separate

A plugin that shelled out to `pip install` and then downloaded a 650 MB
checkpoint behind your back would be hostile, however convenient. So this plugin
**installs nothing and downloads nothing**. It is a client of a process you
start, and when that process is not running it says so rather than failing
obscurely at the first tool call.

The split also buys the warm model: Laya's cold build costs seconds to tens of
seconds, and its default lazy router rebuilds a checkpoint on every language
switch. `laya-mcp serve` pays that once.

## What it contributes

**One service, `ctx.laya`** — so Host code and other plugins can ask for a
judgment directly, without a model round-trip:

```js
const laya = ctx.get('laya')
const result = await laya.ask({ state, questions })
```

It exposes `ask`, `plan`, `health`, `capabilities`, `sidecarUrl`, and `loopback`
— the last being whether state stays on this machine, as a fact rather than a
policy. `plan` is the preflight: the same arithmetic `/ask` reports, with no
forward pass.

**Two tools** — `laya_ask` for a batch of typed questions, and `laya_plan` to
check the token budget before spending a forward pass.

## What it is honest about

Laya truncates silently and its confidence number is widely misread, so the tool
description and the response both say so:

- **An oversized state is cut from the END**, and the answer is then about the
  surviving prefix. The response reports it under `truncated`, and `laya_plan`
  tells you before you ask. Pass `strict: true` to refuse instead — verified
  against the live sidecar, which returns HTTP 400 with `state_truncated` and a
  hint naming `max_len`.
- **`confidence` is not accuracy.** It is a concentration statistic: low whenever
  probability is spread across options even when the top option is right, and
  high on a confident wrong answer. A `noul` also carries a `no` / `uncertain` /
  `yes` `band`, because a calibrated probability is not a decision — a real
  measured example from this stack returned 0.5457 with the band `uncertain`.
- **A silent CPU demotion is reported.** If Laya falls back to CPU after a device
  error it never returns to the accelerator, and nothing in its own output admits
  it. The health surface carries `degraded`, and the tool card appends
  `CPU (degraded)`.

## Configuration

```yaml
- insert:
    - id: laya
      name: 'dsh-laya'
      config:
        sidecarUrl: 'http://127.0.0.1:8787'
        requestTimeoutMs: 120000
        lifecycle: never      # 'attach' to log a reachability check,
                              # 'spawn' to start the sidecar yourself
        spawnCommand: null    # required by 'spawn', e.g. ['laya-mcp', 'serve']
        spawnTimeoutMs: 120000
        logLevel: info
```

`lifecycle` decides what happens when nothing is answering at `sidecarUrl`:

| | |
|---|---|
| `never` | Start nothing; assume something else manages the sidecar. The default. |
| `attach` | Also check `/health` once at load and log what it found — useful when the harness and the sidecar race at startup. |
| `spawn` | Also run `spawnCommand` if nothing answers, then wait for it to come up. |

`spawn` exists because the alternative was worse. The plugin still installs
nothing and downloads nothing — a tool that ran `pip install` and then fetched a
650 MB checkpoint behind your back would be hostile, and that has not changed.
But *launching a sidecar you already installed* is a different act, and without it
every session began by starting a Python process in a terminal by hand, and began
failing again every time that process went away.

Two rules make it safe to leave on:

* A sidecar that is already answering is **attached to and never touched**, so two
  harness sessions cannot put two models on one port.
* A sidecar this plugin started is **stopped when the plugin unmounts**; one it did
  not start is left exactly as it was found.

There is still no option that installs anything or fetches a model, and
`spawnCommand` has no default: this plugin will not guess at an interpreter.

Pointing `sidecarUrl` somewhere that is not loopback is allowed and warns once at
startup, naming the destination: that is the moment the privacy story changes,
and it should not be discoverable only by reading a config file.

## Upstream limits worth knowing before you rely on this

Repeated from upstream's own measurements, because an integration that implies
otherwise is lying to you. The base checkpoints are **near chance zero-shot** on
typed decisions (0.362 for English against a 0.461 majority-class baseline);
`score` is the weakest primitive (35% vs 70% for Jev in independent measurement);
raw calibration error is 0.466 before temperature fitting; and accuracy falls off
above roughly 20 options.

Calibration makes a probability honest. It cannot make a model right.

## Part of the laya-mcp family

| project | what it is |
|---|---|
| [`laya-mcp`](https://github.com/PerryLink/laya-mcp) | The Python core and sidecar: warm model, token-budget preflight, calibration store, and the MCP server. Registered as [`io.github.PerryLink/laya-mcp`](https://registry.modelcontextprotocol.io/v0.1/servers?search=perrylink) in the official MCP Registry. |
| `dsh-laya` | This repository — the DeepSeek Harness integration. |
| [`laya-mcp` on npm](https://www.npmjs.com/package/laya-mcp) | The Node launcher for `npx -y laya-mcp`. |
| `laya-mcp install` | The multi-harness installer for Claude Code, Codex, opencode, OpenClaw and Hermes — a subcommand of the Python package, not a separate distribution. |

## PerryLink DSH Plugin Family

This project is one of the [42 DeepSeek Harness plugins](https://github.com/PerryLink) maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default | |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command | |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | |
| **[dsh-catalog](https://github.com/PerryLink/dsh-catalog)** | DSH Desktop Market standard catalog source for the PerryLink family | |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence | |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Unified session + workspace + config checkpoints with one-shot `/rewind` | |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code, Codex, OpenCode and Hermes sessions, memories and skills into DSH | |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. | |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search | |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Deterministic dataset profiling, cleaning and citation verification | |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review | |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics: load, spill, compaction and cache hit rate | |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Chinese mutual-fund research with sealed, traceable source snapshots | |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issue/CI integration with every write approval-gated | |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry and company research pack: chain map, policy timeline, company cards | |
| **[dsh-kit](https://github.com/PerryLink/dsh-kit)** | One-command starter pack that installs the core family | |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base with hybrid search and citation-aware injection | |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local Ollama model discovery and task-based routing with cloud fallback | |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions, symbols and rename | |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking at the model boundary with a host-side restore table | |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | MCP management console: `/mcp` command, Settings tab and trial calls | |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory protocol (`ctx.memory` + SQLite) | |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse telemetry export from the session event stream | |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Runtime-switchable model output styles | |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Declarative allow/deny/ask rules plus a process-level network policy | |
| **[dsh-plugin-certification](https://github.com/PerryLink/dsh-plugin-certification)** | Community certification registry with repro-checkable grades and badges | |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins | |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-dev knowledge base, agent skill and the `dsh-plugin-dev` CLI toolchain | |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins | |
| **[dsh-plugin-portal](https://github.com/PerryLink/dsh-plugin-portal)** | Zero-dependency static portal rendering the whole plugin family as one page | |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card | |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat, Telegram, Feishu + a session console | |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research reports: evidence ledger, manifest seal, per-claim verdicts | |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional plugin quality scoring with an evidence-backed leaderboard | |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions and workspaces in the Web sidebar with per-pin colors | |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Git-backed cross-device session synchronization with keep-both merges | |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack plus the `plugin_vet` supply-chain gate | |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop: speech-to-text input and text-to-speech replies | |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives with a pass/fail matrix | |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel plus eleven agent tools | |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair | |

## Licence

Apache-2.0. Laya is Apache-2.0 by Convai Innovations. This is an independent
integration and is not affiliated with or endorsed by that project.
