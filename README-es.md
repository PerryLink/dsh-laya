# dsh-laya

Decisiones tipadas de [Laya](https://github.com/NandhaKishorM/laya) — `noul` (sí/no), `choice`, `score` — como servicio Cordis de primera clase y herramientas visibles para el modelo en [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

> **Estado: 0.1.4, en desarrollo.** El plugin se monta y se activa en el Harness, y el contrato de sidecar que habla está verificado de extremo a extremo en una RTX 5060 (carga 9.8 s, 411 ms para tres preguntas en CUDA). Todavía no se ha ejercitado mediante un turno de modelo real en CI.

---

## Instalación

Dos piezas, porque Laya es PyTorch y por tanto no puede vivir dentro de un plugin de Node.

**1. El sidecar** — esto es lo que realmente contiene el modelo:

```bash
pip install "laya-mcp[mcp]"
laya-mcp serve                      # carga una vez, escucha en 127.0.0.1:8787
```

**2. Este plugin:**

```bash
dsh plugin --profile <profile> add dsh-laya
```

Luego confirma que la fila está `active`, no `failed`, y lee la línea de arranque — dice con todas las letras si el estado se queda en esta máquina.

## Por qué el sidecar está separado

Un plugin que ejecutara `pip install` y luego descargara un checkpoint de 650 MB a tus espaldas sería hostil, por cómodo que fuera. Así que este plugin **no instala nada y no descarga nada**. Es un cliente de un proceso que tú arrancas, y cuando ese proceso no está en marcha lo dice, en vez de fallar de forma oscura en la primera llamada a una herramienta.

La separación también compra el modelo caliente: la construcción en frío de Laya cuesta de segundos a decenas de segundos, y su router perezoso por defecto reconstruye un checkpoint en cada cambio de idioma. `laya-mcp serve` paga eso una vez.

## Qué aporta

**Un servicio, `ctx.laya`** — para que el código del Host y otros plugins puedan pedir un juicio directamente, sin una ida y vuelta al modelo:

```js
const laya = ctx.get('laya')
const result = await laya.ask({ state, questions })
```

Expone `ask`, `plan`, `health`, `capabilities`, `sidecarUrl` y `loopback` — el último es si el estado se queda en esta máquina, como un hecho y no como una política. `plan` es el preflight: la misma aritmética que reporta `/ask`, sin pasada hacia adelante.

**Dos herramientas** — `laya_ask` para un lote de preguntas tipadas, y `laya_plan` para comprobar el presupuesto de tokens antes de gastar una pasada hacia adelante.

## De qué es honesto

Laya trunca en silencio y su número de confianza se malinterpreta ampliamente, así que la descripción de la herramienta y la respuesta lo dicen:

- **Un estado demasiado grande se corta por el FINAL**, y la respuesta es entonces sobre el prefijo superviviente. La respuesta lo reporta en `truncated`, y `laya_plan` te lo dice antes de preguntar. Pasa `strict: true` para que se rechace en su lugar — verificado contra el sidecar en vivo, que devuelve HTTP 400 con `state_truncated` y una pista que nombra `max_len`.
- **`confidence` no es la exactitud.** Es un estadístico de concentración: bajo cuando la probabilidad se reparte entre opciones aunque la principal sea la correcta, y alto en una respuesta incorrecta pero segura. Un `noul` lleva además una banda `no` / `uncertain` / `yes`, porque una probabilidad calibrada no es una decisión — un ejemplo real medido en esta pila devolvió 0.5457 con la banda `uncertain`.
- **Se reporta una degradación silenciosa a CPU.** Si Laya cae a CPU tras un error de dispositivo, nunca vuelve al acelerador, y nada en su propia salida lo admite. La superficie de salud lleva `degraded`, y la tarjeta de la herramienta añade `CPU (degraded)`.

## Configuración

```yaml
- insert:
    - id: laya
      name: 'dsh-laya'
      config:
        sidecarUrl: 'http://127.0.0.1:8787'
        requestTimeoutMs: 120000
        lifecycle: never      # 'attach' registra una comprobación de alcance,
                              # 'spawn' arranca el sidecar por ti
        spawnCommand: null    # requerido por 'spawn', p. ej. ['laya-mcp', 'serve']
        spawnTimeoutMs: 120000
        logLevel: info
```

`lifecycle` decide qué ocurre cuando nada responde en `sidecarUrl`:

| | |
|---|---|
| `never` | No arrancar nada; asumir que otra cosa gestiona el sidecar. El valor por defecto. |
| `attach` | Comprobar además `/health` una vez al cargar y registrar lo que encontró — útil cuando el harness y el sidecar compiten al arrancar. |
| `spawn` | Ejecutar además `spawnCommand` si nada responde, y esperar a que levante. |

`spawn` existe porque la alternativa era peor. El plugin sigue sin instalar nada y sin descargar nada — una herramienta que ejecutara `pip install` y luego trajera un checkpoint de 650 MB a tus espaldas sería hostil, y eso no ha cambiado. Pero *lanzar un sidecar que ya instalaste* es un acto distinto, y sin él cada sesión empezaba arrancando a mano un proceso de Python en un terminal, y volvía a fallar cada vez que ese proceso desaparecía.

Dos reglas lo hacen seguro de dejar activado:

* Un sidecar que ya está respondiendo es **atendido y nunca tocado**, así que dos sesiones del harness no pueden poner dos modelos en un mismo puerto.
* Un sidecar que este plugin arrancó **se detiene cuando el plugin se desmonta**; uno que no arrancó se deja exactamente como se encontró.

Sigue sin haber ninguna opción que instale algo o traiga un modelo, y `spawnCommand` no tiene valor por defecto: este plugin no adivinará un intérprete.

Apuntar `sidecarUrl` a algo que no sea loopback está permitido y avisa una vez al arrancar, nombrando el destino: ese es el momento en que cambia la historia de privacidad, y no debería descubrirse solo leyendo un archivo de configuración.

## Límites del proyecto upstream que conviene conocer antes de depender de esto

Repetidos de las propias mediciones del upstream, porque una integración que insinúe lo contrario te está mintiendo. Los checkpoints base están **cerca del azar en zero-shot** sobre decisiones tipadas (0.362 para inglés frente a una línea base de clase mayoritaria de 0.461); `score` es la primitiva más débil (35% frente al 70% de Jev en medición independiente); el error de calibración crudo es 0.466 antes de ajustar la temperatura; y la exactitud decae por encima de unas 20 opciones.

La calibración hace honesta una probabilidad. No puede hacer correcto a un modelo.

**Versión de DSH aplicable:** verificada con `dsh-v0.1.7-alpha.1` (la versión del host a la que apunta esta compilación); requiere `>=0.1.7-alpha.1 <0.2.0`.

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


## Licencia

Apache-2.0. Laya es Apache-2.0, de Convai Innovations. Esta es una integración independiente y no está afiliada ni respaldada por ese proyecto.
