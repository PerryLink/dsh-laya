# dsh-laya

[Laya](https://github.com/NandhaKishorM/laya) typed decisions — `noul` (yes/no),
`choice`, `score` — as a first-class Cordis service and model-visible tools for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> **Status: 0.1.1, work in progress.** The plugin mounts and activates in the
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
| [`laya-mcp`](https://github.com/PerryLink/laya-mcp) | The Python core and sidecar: warm model, token-budget preflight, calibration store, and the MCP server. |
| `dsh-laya` | This repository — the DeepSeek Harness integration. |
| [`laya-mcp` on npm](https://www.npmjs.com/package/laya-mcp) | The Node launcher for `npx -y laya-mcp`. |
| `laya-mcp install` | The multi-harness installer for Claude Code, Codex, opencode, OpenClaw and Hermes — a subcommand of the Python package, not a separate distribution. |

## Licence

Apache-2.0. Laya is Apache-2.0 by Convai Innovations. This is an independent
integration and is not affiliated with or endorsed by that project.
