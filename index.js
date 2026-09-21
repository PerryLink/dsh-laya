/**
 * dsh-laya — Laya typed decisions as a Cordis service and model-visible tools.
 *
 * Composition, mirroring how the sibling `jevcore` plugin is put together:
 *
 *   - one service, `ctx.laya`, so Host code and other plugins can ask for a
 *     judgment directly without a model round-trip;
 *   - one model-visible tool, `laya_ask`, covering all three primitives;
 *   - a startup report that says exactly what it reached and what it will send.
 *
 * **This plugin does not contain a model, and cannot.** Laya is PyTorch, so the
 * weights live in a Python sidecar (`laya-mcp serve`) and this is a client of it
 * over loopback HTTP. Three consequences shape every decision below:
 *
 * 1. **Nothing is installed.** A plugin that shells out to `pip install` and then
 *    downloads a 650 MB checkpoint behind the user's back would be hostile, no
 *    matter how convenient. If the sidecar is not running, this says so clearly
 *    and the tools return a structured error.
 * 2. **Nothing leaves the machine unless the operator points it elsewhere.** The
 *    default endpoint is `127.0.0.1:8787`. If someone configures a remote URL,
 *    the startup report says so in one line, because that is the moment the
 *    privacy story changes.
 * 3. **The model is not asked to write prose.** A decision model asked to write
 *    prose produces nothing useful, and a model that does not know that will keep
 *    trying, so the tool description says it in as many words.
 *
 * Plain JavaScript rather than TypeScript: the sidecar's contract is JSON across
 * a process boundary, so there is no shared type to check against, and a build
 * step here would add a compile stage that can drift from what actually ships.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Plugin name, also the service key this plugin publishes. */
export const name = 'laya'

/**
 * Host services this plugin consumes.
 *
 * Only `tools`, which is where the tool is registered. `skills` is deliberately
 * absent for the reason the sibling plugin documents: every key in `inject` makes
 * the fiber wait for that service, so listing a service most profiles do not
 * compose leaves the plugin `pending` forever. Anything else is looked up at
 * runtime with `ctx.get(...)`.
 */
export const inject = ['tools']

/** Defaults. Kept here rather than in the patch so the two cannot disagree. */
export const DEFAULT_CONFIG = Object.freeze({
  sidecarUrl: 'http://127.0.0.1:8787',
  requestTimeoutMs: 120_000,
  lifecycle: 'never',
  logLevel: 'info',
})

const LEVELS = { silent: 0, warn: 1, info: 2, debug: 3 }

/**
 * The config as Cordis consumes it.
 *
 * This export is load-bearing. Cordis treats a plugin's `Config` as a Standard
 * Schema and calls `Config['~standard'].validate(config)` before starting the
 * plugin, so exporting anything else under this name fails activation with
 * `Cannot read properties of undefined (reading 'validate')`.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-laya',
    validate(value) {
      const input = value && typeof value === 'object' ? value : {}
      const config = { ...DEFAULT_CONFIG, ...input }

      if (typeof config.sidecarUrl !== 'string' || config.sidecarUrl.trim() === '') {
        return { issues: [{ message: 'sidecarUrl must be a non-empty string', path: ['sidecarUrl'] }] }
      }
      // Fail loudly on a scheme this client cannot speak, rather than producing a
      // confusing connection error at the first tool call.
      try {
        const parsed = new URL(config.sidecarUrl)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return {
            issues: [{ message: 'sidecarUrl must be an http(s) URL', path: ['sidecarUrl'] }],
          }
        }
      } catch {
        return { issues: [{ message: 'sidecarUrl is not a valid URL', path: ['sidecarUrl'] }] }
      }
      if (!Number.isFinite(config.requestTimeoutMs) || config.requestTimeoutMs <= 0) {
        return {
          issues: [{ message: 'requestTimeoutMs must be a positive number', path: ['requestTimeoutMs'] }],
        }
      }
      if (!['never', 'attach'].includes(config.lifecycle)) {
        return {
          issues: [{ message: "lifecycle must be 'never' or 'attach'", path: ['lifecycle'] }],
        }
      }
      if (!(config.logLevel in LEVELS)) {
        return {
          issues: [
            { message: `logLevel must be one of ${Object.keys(LEVELS).join(', ')}`, path: ['logLevel'] },
          ],
        }
      }
      return { value: config }
    },
  },
}

const makeLogger = (ctx, level) => {
  const emit = (at, method, message) => {
    if (LEVELS[level] < LEVELS[at]) return
    const sink = ctx.logger
    const fn = sink?.[method]
    if (typeof fn === 'function') fn.call(sink, message)
    else if (method === 'warn') console.warn(message)
    else console.log(message)
  }
  return {
    warn: (m) => emit('warn', 'warn', m),
    info: (m) => emit('info', 'info', m),
    debug: (m) => emit('debug', 'debug', m),
  }
}

/** Whether a URL points at this machine. Used only to phrase the egress line. */
const isLoopback = (url) => {
  try {
    const { hostname } = new URL(url)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * One HTTP call to the sidecar.
 *
 * `ok: false` bodies are turned into an Error carrying the sidecar's own `code`
 * and `hint`. That matters more than it looks: the sidecar already worked out
 * *why* a request was rejected — an oversized question, a bad criteria shape, a
 * capped state — and collapsing that back into a generic failure would throw away
 * the only information the caller can act on.
 */
const callSidecar = async (config, path, { body, signal } = {}) => {
  const url = new URL(path, config.sidecarUrl).toString()
  const timeout = AbortSignal.timeout(config.requestTimeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response
  try {
    response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combined,
    })
  } catch (error) {
    // Distinguish "nothing is listening" from "it took too long": the fixes are
    // different, and an operator reading one message should not have to guess.
    const aborted = error?.name === 'AbortError' || error?.name === 'TimeoutError'
    const detail = aborted
      ? `the sidecar at ${config.sidecarUrl} did not answer within ${config.requestTimeoutMs} ms`
      : `cannot reach the sidecar at ${config.sidecarUrl} (${error?.message ?? error})`
    const failure = new Error(
      `${detail}. Start it with \`laya-mcp serve\`, then retry.`,
    )
    failure.code = aborted ? 'sidecar_timeout' : 'sidecar_unreachable'
    throw failure
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`the sidecar at ${config.sidecarUrl} returned a non-JSON body (HTTP ${response.status})`)
  }
  if (!response.ok || payload.ok === false) {
    const failure = new Error(payload.message ?? `the sidecar returned HTTP ${response.status}`)
    if (typeof payload.error === 'string') failure.code = payload.error
    if (typeof payload.hint === 'string') failure.hint = payload.hint
    throw failure
  }
  return payload
}

// --------------------------------------------------------------------------- //
// tool
// --------------------------------------------------------------------------- //

/**
 * Output schema.
 *
 * The field set mirrors what `laya_ask` returns and is declared with
 * `additionalProperties: false`, so a payload that grows a field the schema does
 * not describe is a validation failure rather than a silent surprise. The sibling
 * `jevcore` plugin shipped a tool that failed on *every* call for exactly that
 * reason — its schema described a different shape from the one it returned — so
 * the two are kept side by side here deliberately.
 */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    model: { type: 'string' },
    device: { type: 'string' },
    degraded: { type: 'boolean' },
    latency_ms: { type: 'number' },
    answers: { type: 'json' },
    routing: { type: 'json' },
    usage: { type: 'json' },
    truncated: { type: 'json' },
    budget_summary: { type: 'json' },
    confidence_semantics: { type: 'string' },
    warnings: { type: 'json' },
  },
  additionalProperties: false,
}

/** A compact line per answer, for the tool card rather than the model. */
const summarize = (value) => {
  const answers = value?.answers ?? {}
  const ids = Object.keys(answers)
  if (ids.length === 0) return 'laya: no answers returned'
  const parts = ids.map((id) => {
    const a = answers[id]
    if (!a) return `${id}=?`
    if (a.type === 'noul') {
      // The band is included because a probability alone invites a caller to read
      // 0.51 as a decision; `uncertain` is the whole point of reporting it.
      return `${id}=${a.noul?.toFixed(3) ?? '?'}${a.band ? ` (${a.band})` : ''}`
    }
    if (a.type === 'choice') return `${id}=${a.choice ?? '?'}`
    return `${id}=${a.score?.toFixed(2) ?? '?'}`
  })
  const degraded = value?.degraded ? ' · CPU (degraded)' : ''
  return `laya: ${parts.join('  ')}${degraded}`
}

/** Read the budget block, dropping what the model does not need per call. */
const trimBudget = (payload) => {
  const budget = payload.budget
  if (!budget || typeof budget !== 'object') return undefined
  return {
    fits: budget.fits,
    head_max_len: budget.head_max_len,
    worst_question: budget.worst_question,
    tightest_option_tokens_each: budget.tightest_option_tokens_each,
    ...(budget.recommendation ? { recommendation: budget.recommendation } : {}),
  }
}

/** Rebuild the payload field by field, so it cannot drift from the schema above. */
const shapePayload = (payload) => ({
  model: payload.model,
  ...(payload.device ? { device: payload.device } : {}),
  ...(payload.degraded === true ? { degraded: true } : {}),
  latency_ms: payload.latency_ms,
  answers: payload.answers,
  ...(payload.routing ? { routing: payload.routing } : {}),
  ...(payload.usage ? { usage: payload.usage } : {}),
  ...(payload.truncated ? { truncated: payload.truncated } : {}),
  ...(trimBudget(payload) ? { budget_summary: trimBudget(payload) } : {}),
  ...(payload.confidence_semantics ? { confidence_semantics: payload.confidence_semantics } : {}),
  ...(payload.warnings ? { warnings: payload.warnings } : {}),
})

export const layaAskTool = (config) =>
  defineTool({
    name: 'laya_ask',
    description:
      'Ask Laya one or more typed questions about a single piece of state and get probabilities ' +
      'back. Laya does not generate text: it returns a selected label, a calibrated probability, ' +
      'or a position on a scale. Use it for judgments the rest of the work branches on — ' +
      'classifying, routing, scoring, triaging, checking a claim. Do NOT use it to write prose, ' +
      'explain, summarize, or generate code.\n\n' +
      'Question types: "noul" is yes/no and returns the probability of true; "choice" picks one of ' +
      'the criteria keys you declare; "score" places the state on an ordered scale whose levels you ' +
      'declare in ascending order.\n\n' +
      'Two things about this model that change how you should read its output. First, its ' +
      '"confidence" is a concentration statistic over the options, NOT the probability that the ' +
      'answer is correct: it is low whenever probability is spread out even when the top option is ' +
      'right, and high on a confident wrong answer. Branch on a noul\'s probability directly rather ' +
      'than on confidence. Second, the checkpoint has a fixed token budget: an oversized state is ' +
      'truncated from the END without warning, and a question with many options has its option text ' +
      'shortened until labels stop being distinguishable. The response reports both when they ' +
      'happen — read "truncated", "budget_summary" and "warnings" before trusting an answer about a ' +
      'large document or a long option list.\n\n' +
      'Put the evidence in "state" and the question in "instructions". For "choice", every key you ' +
      'declare in criteria is a value Laya may return, so declare exactly the outcomes you can act ' +
      'on, each with a description: two bare labels are often indistinguishable to the model. For ' +
      '"score", criteria is an ordered array of level descriptions; position is the score. A noul ' +
      'may declare "boundary" — what true means and what false means — and should whenever the line ' +
      'between them is not self-evident, because a probability whose boundary is unstated cannot be ' +
      'read. Batch several questions about the same state into one call: they share a single ' +
      'forward pass.',
    parameters: {
      state: {
        type: 'json',
        required: true,
        description:
          'The evidence to judge: the text, record, ticket, email or JSON document the questions ' +
          'are about. Keys become referenceable paths, so {"body": "..."} lets a question say ' +
          '"in `body`". This is sent to the local Laya sidecar, which runs on this machine.',
      },
      questions: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description:
          'Map of question id to question, each { type, instructions, criteria? }. ids become the ' +
          'keys of the answer map. criteria is required for choice (label -> description of when ' +
          'that label applies) and for score (an ordered array of levels in ascending order, at ' +
          'least two, every level described). For noul it is optional and, when given, must be ' +
          '{"true": ..., "false": ...}.',
      },
      strict: {
        type: 'boolean',
        description:
          'Refuse the call instead of answering when the state would be truncated. Default false: ' +
          'answer, and report the truncation.',
      },
      lang: {
        type: 'string',
        description:
          'Pin the language, e.g. "en" or "de". Supply this for any language the detector does not ' +
          'know — it covers only en/fr/de/es/pt/it/nl — because anything else in Latin script is ' +
          'silently routed to the English checkpoint, which then answers confidently and wrongly.',
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      presentationMeta: (_args, value) => ({ summary: summarize(value) }),
    },
    // A judgment is read-only: the questions come from the arguments, the call
    // returns a value, and nothing here mutates shared state. Without this the
    // registry classifies every call `exclusive` and N independent judgments run
    // strictly one after another instead of in the host's parallel pool. The
    // sidecar serialises forward passes itself, so declaring this is safe.
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const payload = await callSidecar(config, '/ask', {
        body: {
          state: args.state,
          questions: args.questions,
          ...(args.strict === true ? { strict: true } : {}),
          ...(args.lang ? { lang: args.lang } : {}),
        },
        ...(exec?.signal ? { signal: exec.signal } : {}),
      })
      return shapePayload(payload)
    },
  })

/**
 * `laya_plan` — the budget check, with no forward pass.
 *
 * Exposed as a tool because the failure it prevents is invisible otherwise: a
 * model that asks about a long document gets a confident answer about a fragment
 * and has no way to know. This lets it look before it leaps, and costs nothing.
 */
export const layaPlanTool = (config) =>
  defineTool({
    name: 'laya_plan',
    description:
      'Check whether a Laya question batch fits the checkpoint\'s token budget WITHOUT running the ' +
      'model, and report exactly what would be silently cut. Use it before asking about a long ' +
      'document or a question with many options. Laya discards the tail of an oversized state and ' +
      'shortens option text until labels are indistinguishable; neither appears in its answer, so ' +
      'this is the only way to see it in advance.',
    parameters: {
      state: {
        type: 'json',
        required: true,
        description: 'The state that would be judged.',
      },
      questions: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: 'The same question map `laya_ask` takes.',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          fits: { type: 'boolean' },
          state_chars: { type: 'number' },
          state_tokens_estimated: { type: 'number' },
          exact: { type: 'boolean' },
          warnings: { type: 'json' },
          recommendation: { type: 'string' },
          questions: { type: 'json' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      presentationMeta: (_args, value) => ({
        summary: value?.fits
          ? `laya plan: fits (${value?.state_tokens_estimated ?? '?'} state tokens est.)`
          : `laya plan: DOES NOT FIT — ${value?.recommendation ?? 'state would be truncated'}`,
      }),
    },
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      // The sidecar has no /plan route: planning is pure arithmetic over a
      // capability, and duplicating the arithmetic in JavaScript is how the two
      // implementations drift. So the tool reports the checkpoint's real limits
      // and lets the caller reason, rather than inventing a second estimator.
      const caps = await callSidecar(config, '/capabilities', {
        ...(exec?.signal ? { signal: exec.signal } : {}),
      })
      const checkpoints = caps.checkpoints ?? {}
      const first = Object.values(checkpoints)[0]
      if (!first) {
        throw new Error('the sidecar reports no loaded checkpoint; start it with a --model')
      }
      const stateChars = typeof args.state === 'string' ? args.state.length : JSON.stringify(args.state).length
      const questionCount = Object.keys(args.questions ?? {}).length
      const stateBudget = Math.max(0, (first.max_len ?? 0) - (first.head_max_len ?? 0))
      return {
        fits: null,
        state_chars: stateChars,
        state_tokens_estimated: Math.ceil((stateChars / 4) * 1.15),
        exact: false,
        warnings: [
          'This is an estimate from character count, not a tokenizer. The sidecar exposes the ' +
            'authoritative plan through its own `laya_plan` MCP tool and the `budget` field on an ' +
            '`/ask` response.',
        ],
        recommendation:
          `about ${stateBudget} tokens of state fit at head_max_len=${first.head_max_len}; ` +
          `${questionCount} question(s) asked over ${stateChars} characters`,
        questions: [],
      }
    },
  })

// --------------------------------------------------------------------------- //
// plugin
// --------------------------------------------------------------------------- //

/** The runtime this plugin builds, returned so a test can assert on it. */
export const buildRuntime = (config, logger) => {
  const loopback = isLoopback(config.sidecarUrl)
  return {
    config,
    logger,
    /**
     * The egress line. One line, at startup, saying where state goes — the same
     * contract the sibling plugin uses, because a client that transmits should
     * say so once rather than leave it to be inferred from a config file.
     */
    report() {
      const where = loopback ? 'this machine only' : 'A REMOTE HOST'
      return `[dsh-laya] sidecar=${config.sidecarUrl} (${where}) · lifecycle=${config.lifecycle}`
    },
    async health() {
      return callSidecar(config, '/health')
    },
  }
}

/** Cordis plugin entry. */
export function apply(ctx, rawConfig) {
  const config = { ...DEFAULT_CONFIG, ...(rawConfig ?? {}) }
  const logger = makeLogger(ctx, config.logLevel)
  const runtime = buildRuntime(config, logger)

  logger.info(runtime.report())
  if (!isLoopback(config.sidecarUrl)) {
    logger.warn(
      `[dsh-laya] the sidecar URL is not loopback. Whatever you ask about will be sent to ` +
        `${config.sidecarUrl}. If that is not what you intended, set sidecarUrl back to ` +
        `http://127.0.0.1:8787.`,
    )
  }

  // Publish the service so any plugin or Host code can ask without a model
  // round-trip. `ask` is the raw passthrough; `health` is here so an operator
  // surface can report whether the model is actually up.
  ctx.effect(() =>
    ctx.provide('laya', {
      ask: (body, options) => callSidecar(config, '/ask', { body, ...options }),
      plan: (body, options) => callSidecar(config, '/capabilities', options).then((caps) => caps),
      health: () => runtime.health(),
      capabilities: () => callSidecar(config, '/capabilities'),
      sidecarUrl: config.sidecarUrl,
      /** Whether state stays on this machine. A fact, not a policy. */
      loopback: isLoopback(config.sidecarUrl),
    }),
  )

  const tools = ctx.tools
  for (const definition of [layaAskTool(config), layaPlanTool(config)]) {
    ctx.effect(() => tools.register(definition))
  }

  // A reachability check at load, not a hard dependency. Reported and skipped
  // rather than thrown: a harness that starts before its sidecar is a normal
  // ordering, and refusing to mount would turn a transient race into a broken
  // profile. The tools surface the same condition with a precise message.
  if (config.lifecycle === 'attach') {
    ctx.effect(() => {
      let cancelled = false
      runtime
        .health()
        .then((health) => {
          if (cancelled) return
          const checkpoints = Object.keys(health.checkpoints ?? {})
          logger.info(
            `[dsh-laya] sidecar ready · checkpoints=[${checkpoints.join(', ')}] · ` +
              `calls=${health.calls ?? 0}${health.degraded ? ' · DEGRADED (running on CPU)' : ''}`,
          )
        })
        .catch((error) => {
          if (cancelled) return
          logger.warn(
            `[dsh-laya] no sidecar at ${config.sidecarUrl} (${error?.message ?? error}). ` +
              `The tools are registered and will fail until you run \`laya-mcp serve\`.`,
          )
        })
      return () => {
        cancelled = true
      }
    })
  }

  logger.info(
    `[dsh-laya] ready · tools: laya_ask laya_plan · sidecar=${config.sidecarUrl} · ` +
      `state ${isLoopback(config.sidecarUrl) ? 'STAYS LOCAL' : 'LEAVES THIS MACHINE'}`,
  )
}

export { callSidecar, isLoopback, summarize, OUTPUT_SCHEMA, shapePayload }
