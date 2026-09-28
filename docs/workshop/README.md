# Workshop guide: vibe coding an OSINT intelligence platform

A hands-on workshop for building a real-time 3D geospatial intelligence platform by directing an AI coding agent instead of typing the code yourself.

You bring a coding agent (Claude Code, Codex or similar). This kit brings the prompts, specs, plans and skills that steer it, step by step, from an empty folder to a live command-center globe streaming public OSINT feeds, with cinematic post-processing filters. The point is to practise "vibe coding" as real engineering: spec-driven development, disciplined prompting, review gates and AI-assisted debugging.

The background and rationale are in the [whitepaper](whitepaper.pdf).

## What you'll build

A simplified, self-hostable clone of a browser-based intelligence dashboard:

- A 3D globe (CesiumJS) over a dark tactical basemap, filling the screen.
- Live OSINT layers streamed in real time: commercial and military flights, ships, satellites and the ISS, earthquakes, radiation and critical infrastructure.
- Cinematic post-processing filters: CRT, Night Vision and FLIR.
- A declarative source engine, where adding a data feed means writing one YAML file (HTTP transport; JSON, GeoJSON, XML or CSV).

| Layer | Tech |
| :-- | :-- |
| Frontend | Vite, React 18, Redux Toolkit + RTK Query, MUI, TypeScript, CesiumJS, WebSocket |
| Backend | Node.js, Express, TypeScript, SQLite (`better-sqlite3`), WebSocket, OpenAPI 3.0 |
| Tooling | Makefile, NPM workspaces monorepo |

This repository also contains a finished reference build of the platform (`backend/`, `frontend/`, `sources.d/`), documented in [../architecture.md](../architecture.md). To do the workshop as intended, from an empty folder, work in a separate directory or branch and bring only the kit with you: `docs/workshop/`, `skills/`, `AGENTS.md`, `CLAUDE.md` and `RTK.md`.

## Who this is for

Security researchers, OSINT practitioners and engineers who want to learn AI-assisted development by building something real. You should be comfortable with a terminal and Git. No prior experience with AI agents is required.

The materials are model-agnostic. The prompts are plain Markdown with no proprietary syntax, so they work with Claude Sonnet 4.5, GPT-4o-class models and similar, including cheaper or self-hosted models.

## Kit layout

```
docs/workshop/
├── README.md                 # this guide
├── whitepaper.pdf
├── prompts/
│   └── PROMPT_1..6_*.md      # the six sequential build prompts you run
└── examples/
    ├── specs/                # pre-made example specs (fallback / token-saver)
    └── plans/                # pre-made example plans (fallback / token-saver)
skills/onboard-source/
├── SKILL.md                  # skill: turn any URL into a source YAML
└── examples/                 # 19 ready-to-use source definitions
AGENTS.md, CLAUDE.md, RTK.md  # agent and tooling context (RTK usage, conventions)
```

When you run a prompt, it tells your agent to write its spec and plan to `docs/superpowers/specs/` and `docs/superpowers/plans/` (for example `docs/superpowers/specs/01-project-setup-spec.md`). Those are **your** generated documents. The copies in [examples/](examples/) are only a reference or safety net for when you get stuck or want to save tokens.

The `examples/` folder also holds the design and plan the kit itself was built from (`2026-07-26-reconvillage-workshop-*`) and a harness-hardening design (`2026-07-27-harness-hardening-design.md`). They are background reading, not build steps.

## How the workshop works

The methodology is spec-driven development powered by the [Superpowers](https://github.com/obra/superpowers) skill set. Nothing gets coded until the design is written down and reviewed:

```
  PROMPT  ─▶  SPEC  ─▶  PLAN  ─▶  SUBAGENT-DRIVEN BUILD
             (review)   (review)
```

A design mistake caught in the spec costs minutes; the same mistake caught in the code costs hours. The build is split into six self-contained steps, and each one produces a working piece you can see and test.

### Two paths

**Path A: full spec-driven (recommended for learning).** Give your agent `prompts/PROMPT_N_*.md`. It generates a spec and a plan under `docs/superpowers/`. You review both, and then it executes the plan with subagents.

**Path B: token-saver (for limited accounts).** Skip generation and point your agent straight at a provided plan, for example:

> Use a subagent-driven approach to execute `docs/workshop/examples/plans/01-project-setup-plan.md`.

Review the result, then continue with plans 2 to 6.

On either path, validate at every milestone. After each step, open http://localhost:3000, exercise what was built, and then tell the agent either to fix the bugs you found or to continue to the next step.

### The six build steps

| # | Step | Prompt | Example spec / plan | Produces |
| :-- | :-- | :-- | :-- | :-- |
| 1 | Project setup and monorepo foundation | [PROMPT_1](prompts/PROMPT_1_PROJECT_SETUP.md) | [spec](examples/specs/01-project-setup-spec.md) / [plan](examples/plans/01-project-setup-plan.md) | Makefile, backend (Express + SQLite + OpenAPI), Vite/React/MUI frontend with a simple Cesium globe |
| 2 | Declarative ingestion engine | [PROMPT_2](prompts/PROMPT_2_INGESTION_ENGINE.md) | [spec](examples/specs/02-ingestion-engine-spec.md) / [plan](examples/plans/02-ingestion-engine-plan.md) | YAML source loader, HTTP fetcher, JSON/GeoJSON/XML/CSV parsers, field mapper, scheduler |
| 3 | Backend WebSocket API | [PROMPT_3](prompts/PROMPT_3_BACKEND_WEBSOCKET_API.md) | [spec](examples/specs/03-backend-websocket-api-spec.md) / [plan](examples/plans/03-backend-websocket-api-plan.md) | Real-time telemetry push and heartbeat channel |
| 4 | Frontend globe dashboard | [PROMPT_4](prompts/PROMPT_4_FRONTEND_GLOBE_DASHBOARD.md) | [spec](examples/specs/04-frontend-globe-dashboard-spec.md) / [plan](examples/plans/04-frontend-globe-dashboard-plan.md) | Live markers, layer controls, entity inspector, telemetry HUD |
| 5 | Cinematic filters and polish | [PROMPT_5](prompts/PROMPT_5_CINEMATIC_FILTERS_POLISH.md) | [spec](examples/specs/05-cinematic-filters-polish-spec.md) / [plan](examples/plans/05-cinematic-filters-polish-plan.md) | CRT, Night Vision and FLIR overlays |
| 6 | Integration and debug | [PROMPT_6](prompts/PROMPT_6_INTEGRATION_DEBUG.md) | [spec](examples/specs/06-integration-debug-spec.md) / [plan](examples/plans/06-integration-debug-plan.md) | End-to-end wiring, visual verification, bug fixes |

## Getting started

1. Clone this repository and open it in your coding agent.
2. Install the recommended tooling (below). At a minimum, install Superpowers, RTK and Chrome DevTools MCP.
3. Run step 1 using Path A or Path B. Review the generated spec and plan, then let the agent build.
4. Start the app with `make dev` and open http://localhost:3000.
5. Repeat for steps 2 to 6, validating each milestone.
6. Extend it by adding your own data feeds with the `onboard-source` skill. See [../data-sources.md](../data-sources.md).

## Recommended tooling

This is the tested set. Any of it can be swapped.

| Tool | Role | Link |
| :-- | :-- | :-- |
| Superpowers | Spec-driven workflow: brainstorming, spec and plan writing, subagent execution, verification | https://github.com/obra/superpowers |
| Context7 | Pulls current library and framework docs into context on demand | https://github.com/upstash/context7 |
| RTK (Rust Token Killer) | Compresses noisy command output (builds, tests, git) by 60 to 90% | https://github.com/rtk-ai/rtk |
| Engram | Persistent agent memory across sessions | https://github.com/Gentleman-Programming/engram |
| Chrome DevTools MCP | Lets the agent drive a real browser to visually verify the UI | https://github.com/ChromeDevTools/chrome-devtools-mcp |

Optional token and context helpers (pick one, not both): [Ponytail](https://github.com/DietrichGebert/ponytail) or [Caveman](https://github.com/juliusbrussee/caveman).

A monthly subscription is usually cheaper for heavy interactive use. Pay-per-token APIs scale, but the cost adds up quickly. If you are token-limited, use Path B and lean on RTK and Engram.

## Data sources

Sources are declarative: each is a single YAML file describing how to fetch a public feed and map it onto the globe. Adding one needs no engine changes.

- **Add any feed with the skill.** [`skills/onboard-source/SKILL.md`](../../skills/onboard-source/SKILL.md) takes a URL, inspects the response and writes a source definition for you. Check its output against [../data-sources.md](../data-sources.md), because the skill's own template describes schema features the engine does not implement.
- **Start from an example.** [`skills/onboard-source/examples/`](../../skills/onboard-source/examples/) has 19 no-auth source definitions covering flights, ships, satellites and the ISS, earthquakes, volcanoes and wildfires, and radiation, nuclear and power. Copy one into `sources.d/` and restart the backend.

A source is just data fetched over HTTP, parsed, and pinned to a point:

```yaml
name: usgs_earthquakes
source_type: usgs_earthquakes
transport: { type: http_poll, url: 'https://earthquake.usgs.gov/.../all_hour.geojson', interval: '60s' }
parser: { format: geojson, records_path: 'features' }
entity: { external_id: 'id', name: 'properties.place', category: 'geological' }
observation: { latitude: 'geometry.coordinates[1]', longitude: 'geometry.coordinates[0]', timestamp: 'properties.time' }
recording: { mode: upsert }
```

## Workshop outline (150 minutes)

| Part | Time | Focus |
| :-- | :-- | :-- |
| 1. Intro to vibe coding | 20 min | What it means, mental models, choosing a model, agentic workflows, common mistakes |
| 2. Prompt engineering | 25 min | Structuring prompts, decomposition, iterating vs. regenerating, when to intervene |
| 3. Building the platform | 75 min | Hands-on: build the OSINT globe with the prompts, specs and plans in this kit |
| 4. Lessons and advanced techniques | 20 min | What AI does well and where it struggles, tech debt, cost, recommended workflows |

Parts 1, 2 and 4 are presented. Part 3 is the hands-on build this kit supports.

## Prompt-writing principles

The prompts follow a universal, model-agnostic template: plain Markdown, in a strict top-to-bottom order, so they behave consistently across models.

1. **Persona**: who the model should be.
2. **Core task**: the single directive.
3. **Constraints**: the rules, as a bulleted list.
4. **Format requirements**: exactly what the output should look like.
5. **Analysis steps** (optional): think before answering.
6. **Input data**: the variable data, fenced at the very bottom.

Headers chunk attention, lists parse better than prose, bold marks hard rules, and positive framing ("do X") works better than negatives ("don't do Y").

## Credits

A simplified, workshop-sized reimagining of a real geospatial-intelligence platform: the same striking result, on a stack you can build in an afternoon with an AI pair.
