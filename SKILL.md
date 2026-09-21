---
name: laya
description: Ask the local Laya decision model for typed noul, choice and score judgments through the harness, and branch on the probabilities instead of on generated prose.
when-to-use: The current step is a judgment over evidence already in context, and what happens next depends on a typed answer. Skip it when the user needs generated text, a patch, or a shell command - Laya does not write.
---

# Laya in this harness

`dsh-laya` mounts a local Laya model as a Cordis service and two model-visible
tools. Nothing leaves the machine: the checkpoint runs in a Python sidecar on
loopback, and the plugin is a client of it.

## The two tools

| tool | what it is for |
| --- | --- |
| `laya_ask` | A batch of typed questions over one state. The general one. |
| `laya_plan` | "Will this fit, and what will be cut?" No model runs, so it is free. |

A `noul` is yes/no and returns `P(true)` plus a `no`/`uncertain`/`yes` band. A
`choice` picks one label from a set you name. A `score` places the state on an
ordered scale you write.

## Always supply the option text

This is the rule that decides whether an answer means anything.

A `noul` with no `boundary` is answered "false" almost regardless of the state -
measured at 40 of 40 items in both English and Chinese, exactly chance, because
the checkpoint renders every noul as `false: ...` / `true: ...` and carries a
prior against the word. Give it the boundary and the same forty items score 1.000
and 0.975.

```json
{
  "type": "noul",
  "instructions": "Does the user threaten to cancel?",
  "boundary": {
    "true": "an explicit threat to cancel or not renew",
    "false": "no threat, however annoyed the tone"
  }
}
```

For a `choice`, the descriptions are what make the labels distinguishable - two
bare labels often are not. Include a no-match option when nothing may fit.

## How to read it

- **`confidence` is not accuracy.** It is a concentration statistic over the
  distribution: low when probability is spread out even when the top option is
  right, high on a confident wrong answer. Branch on the probability.
- **A `noul` near 0.5 is undecided, not a mild yes.**
- **The base checkpoint is near chance zero-shot on typed decisions** - 0.362
  against a 0.461 majority-class baseline. Calibration can make a probability
  honest; it cannot make the model right.
- **Laya truncates the state from the end without saying so in the answer.** Read
  `truncated`, `budget_summary` and `warnings`, or call `laya_plan` first.

## From another plugin

```js
const laya = ctx.get('laya')
const result = await laya.ask({ state, questions })
```

The service also exposes `plan`, `health`, `capabilities`, `sidecarUrl` and
`loopback` - the last being whether state stays on this machine, as a fact rather
than a policy.

## When the tools fail

`sidecar_unreachable` means no model process is answering. Either start one with
`laya-mcp serve`, or set the plugin's `lifecycle` to `spawn` with a
`spawnCommand` so the plugin starts it and stops it again on unmount. Do not
invent an answer when a call fails; report it.
