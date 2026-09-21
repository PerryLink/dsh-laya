# dsh-laya

`dsh-laya` will bring Laya's decision engine to DeepSeek Harness as a first-class Cordis service, plus model-visible tools.

> **Status: work in progress.** This repository was created to claim the name. The implementation is under active development and nothing here is installable yet — there is no plugin to add to a harness profile.

## Planned

- A Cordis service other plugins in the harness can depend on, so typed decisions are reachable without shelling out.
- Model-visible tools for `noul`, `choice`, and `score`, so the model can ask one narrow question instead of spending a whole turn on prose.
- Configuration through a plugin row, consistent with how other harness plugins are mounted.
- Structured results and errors that a calling plugin can branch on.

## Part of the layacore family

- `layacore` — the installable, hardened layer around Laya's typed decisions.
- `layacore-mcp` — the MCP server exposing those decisions.
- `layacore-install` — installs that MCP server into a chosen harness.
- `dsh-laya` — this repository, the DeepSeek Harness integration.

## Not here yet

No published package and no plugin bundle. Nothing here is installable yet.

## License

Apache-2.0. See [LICENSE](LICENSE).
