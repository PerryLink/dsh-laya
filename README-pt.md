# dsh-laya

Decisões tipadas do [Laya](https://github.com/NandhaKishorM/laya) — `noul` (sim/não), `choice`, `score` — como serviço Cordis de primeira classe e ferramentas visíveis para o modelo no [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

> **Estado: 0.1.1, em desenvolvimento.** O plugin monta e ativa no Harness, e o contrato de sidecar que fala está verificado de ponta a ponta numa RTX 5060 (carregamento 9.8 s, 411 ms para três perguntas em CUDA). Ainda não foi exercitado através de um turno de modelo real em CI.

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

## Parte da família laya-mcp

| projeto | o que é |
|---|---|
| [`laya-mcp`](https://github.com/PerryLink/laya-mcp) | O núcleo em Python e o sidecar: modelo quente, preflight de orçamento de tokens, armazém de calibração e o servidor MCP. Registado como [`io.github.PerryLink/laya-mcp`](https://registry.modelcontextprotocol.io/v0.1/servers?search=perrylink) no registo MCP oficial. |
| `dsh-laya` | Este repositório — a integração com o DeepSeek Harness. |
| [`laya-mcp` no npm](https://www.npmjs.com/package/laya-mcp) | O lançador de Node para `npx -y laya-mcp`. |
| `laya-mcp install` | O instalador multi-harness para Claude Code, Codex, opencode, OpenClaw e Hermes — um subcomando do pacote de Python, não uma distribuição separada. |

## Licença

Apache-2.0. O Laya é Apache-2.0, da Convai Innovations. Esta é uma integração independente e não está afiliada nem é endossada por esse projeto.
