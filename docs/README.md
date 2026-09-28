# Documentation

Reference documentation for the MK-OSINT platform and the workshop kit that builds it.

## Platform

| Document | What it covers |
| :-- | :-- |
| [architecture.md](architecture.md) | Components, data flow, the ingestion pipeline, the SQLite schema, the WebSocket broadcaster, the frontend store and components, cinematic filters and globe styles. |
| [api.md](api.md) | REST endpoints with example requests and responses, the error envelope, and the WebSocket telemetry protocol. |
| [data-sources.md](data-sources.md) | The YAML source schema the engine actually supports, a worked example, the sources shipped in `sources.d/`, and how to use the `onboard-source` skill. |
| [development.md](development.md) | Prerequisites, install, running locally, environment variables, tests, type checking, formatting, and CI. |

## Workshop

| Document | What it covers |
| :-- | :-- |
| [workshop/README.md](workshop/README.md) | The workshop guide: audience, methodology, the two paths, the six build steps, the 150-minute outline, prompt-writing principles and recommended tooling. |
| [workshop/prompts/](workshop/prompts/) | The six sequential build prompts (`PROMPT_1` to `PROMPT_6`). |
| [workshop/examples/](workshop/examples/) | Pre-made specs and plans for each step, used as a fallback or to save tokens. |
| [workshop/whitepaper.pdf](workshop/whitepaper.pdf) | The workshop whitepaper. |
