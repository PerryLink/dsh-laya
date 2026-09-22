# dsh-laya

Decisões tipadas do [Laya](https://github.com/NandhaKishorM/laya) — `noul` (sim/não), `choice`, `score` — como serviço Cordis de primeira classe e ferramentas visíveis para o modelo no [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

> **Estado: 0.1.4, em desenvolvimento.** O plugin monta e ativa no Harness, e o contrato de sidecar que fala está verificado de ponta a ponta numa RTX 5060 (carregamento 9.8 s, 411 ms para três perguntas em CUDA). Ainda não foi exercitado através de um turno de modelo real em CI.

---

## Instalação

Duas peças, porque o Laya é PyTorch e por isso não pode viver dentro de um plugin de Node.

**1. O sidecar** — é isto que realmente contém o modelo:

```bash
pip install "laya-mcp[mcp]"
laya-mcp serve                      # carrega uma vez, escuta em 127.0.0.1:8787
```

**2. Este plugin:**

```bash
dsh plugin --profile <profile> add dsh-laya
```

Depois confirma que a linha está `active`, não `failed`, e lê a linha de arranque — diz com todas as letras se o estado fica nesta máquina.

## Porque é que o sidecar está separado

Um plugin que executasse `pip install` e depois descarregasse um checkpoint de 650 MB às tuas costas seria hostil, por muito conveniente que fosse. Por isso este plugin **não instala nada e não descarrega nada**. É um cliente de um processo que tu arrancas, e quando esse processo não está a correr di-lo, em vez de falhar de forma obscura na primeira chamada a uma ferramenta.

A separação também compra o modelo quente: a construção a frio do Laya custa de segundos a dezenas de segundos, e o seu router preguiçoso por defeito reconstrói um checkpoint a cada mudança de idioma. O `laya-mcp serve` paga isso uma vez.

## O que contribui

**Um serviço, `ctx.laya`** — para que o código do Host e outros plugins possam pedir um juízo diretamente, sem uma ida e volta ao modelo:

```js
const laya = ctx.get('laya')
const result = await laya.ask({ state, questions })
```

Expõe `ask`, `plan`, `health`, `capabilities`, `sidecarUrl` e `loopback` — o último é se o estado fica nesta máquina, como facto e não como política. O `plan` é o preflight: a mesma aritmética que o `/ask` reporta, sem passagem forward.

**Duas ferramentas** — `laya_ask` para um lote de perguntas tipadas, e `laya_plan` para verificar o orçamento de tokens antes de gastar uma passagem forward.

## Do que é honesto

O Laya trunca em silêncio e o seu número de confiança é amplamente mal interpretado, por isso a descrição da ferramenta e a resposta di-lo:

- **Um estado demasiado grande é cortado pelo FIM**, e a resposta é então sobre o prefixo sobrevivente. A resposta reporta-o em `truncated`, e o `laya_plan` diz-te antes de perguntares. Passa `strict: true` para ser recusado em vez disso — verificado contra o sidecar em execução, que devolve HTTP 400 com `state_truncated` e uma dica que nomeia `max_len`.
- **O `confidence` não é exatidão.** É um estatístico de concentração: baixo quando a probabilidade está espalhada pelas opções mesmo quando a principal está certa, e alto numa resposta errada mas confiante. Um `noul` traz também uma banda `no` / `uncertain` / `yes`, porque uma probabilidade calibrada não é uma decisão — um exemplo real medido nesta pilha devolveu 0.5457 com a banda `uncertain`.
- **Uma degradação silenciosa para CPU é reportada.** Se o Laya cai para CPU após um erro de dispositivo, nunca regressa ao acelerador, e nada na sua própria saída o admite. A superfície de saúde traz `degraded`, e o cartão da ferramenta acrescenta `CPU (degraded)`.

## Configuração

```yaml
- insert:
    - id: laya
      name: 'dsh-laya'
      config:
        sidecarUrl: 'http://127.0.0.1:8787'
        requestTimeoutMs: 120000
        lifecycle: never      # 'attach' registra uma verificação de alcance,
                              # 'spawn' arranca o sidecar por ti
        spawnCommand: null    # exigido por 'spawn', p. ex. ['laya-mcp', 'serve']
        spawnTimeoutMs: 120000
        logLevel: info
```

O `lifecycle` decide o que acontece quando nada responde em `sidecarUrl`:

| | |
|---|---|
| `never` | Não arrancar nada; assumir que outra coisa gere o sidecar. O padrão. |
| `attach` | Verificar também `/health` uma vez ao carregar e registar o que encontrou — útil quando o harness e o sidecar competem no arranque. |
| `spawn` | Executar também `spawnCommand` se nada responder, e esperar que levante. |

O `spawn` existe porque a alternativa era pior. O plugin continua a não instalar nada e a não descarregar nada — uma ferramenta que executasse `pip install` e depois trouxesse um checkpoint de 650 MB às tuas costas seria hostil, e isso não mudou. Mas *lançar um sidecar que já instalaste* é um ato diferente, e sem ele cada sessão começava por arrancar à mão um processo de Python num terminal, e voltava a falhar sempre que esse processo desaparecia.

Duas regras tornam-no seguro de deixar ligado:

* Um sidecar que já está a responder é **atendido e nunca tocado**, por isso duas sessões do harness não podem pôr dois modelos na mesma porta.
* Um sidecar que este plugin arrancou **é parado quando o plugin é desmontado**; um que não arrancou é deixado exatamente como foi encontrado.

Continua a não haver nenhuma opção que instale algo ou traga um modelo, e o `spawnCommand` não tem valor por defeito: este plugin não adivinha um interpretador.

Apontar o `sidecarUrl` para algo que não seja loopback é permitido e avisa uma vez no arranque, nomeando o destino: esse é o momento em que a história da privacidade muda, e não deve ser descoberto apenas lendo um ficheiro de configuração.

## Limites do upstream que vale a pena conhecer antes de depender disto

Repetidos das próprias medições do upstream, porque uma integração que insinue o contrário está a mentir-te. Os checkpoints base estão **perto do acaso em zero-shot** em decisões tipadas (0.362 para inglês contra uma linha de base de classe maioritária de 0.461); o `score` é a primitiva mais fraca (35% contra os 70% do Jev em medição independente); o erro de calibração cru é 0.466 antes de ajustar a temperatura; e a exatidão cai acima de cerca de 20 opções.

A calibração torna uma probabilidade honesta. Não consegue tornar um modelo correto.

**Versão do DSH aplicável:** verificada com `dsh-v0.1.7-alpha.1` (a versão do host que esta compilação visa); requer `>=0.1.7-alpha.1 <0.2.0`.

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


## Licença

Apache-2.0. O Laya é Apache-2.0, da Convai Innovations. Esta é uma integração independente e não está afiliada nem é endossada por esse projeto.
