# ReconVillage OSINT Platform Vibe-Coding Workshop Design Specification

## Overview

This specification details the architecture, prompt sequence, pre-built Superpowers specs and implementation plans, `AGENTS.md` context, and custom source onboarding skill for the ReconVillage Vibe-Coding Workshop.

The goal of the workshop is to guide students through building a real-time 3D Geospatial Open Source Intelligence (OSINT) dashboard using vibe coding, spec-driven development (Superpowers), and token-saving development tools (RTK, Engram, Context7, Chrome DevTools MCP).

---

## 1. Core Architecture & Stack

### Backend Stack
- **Runtime**: Node.js with TypeScript (`tsx` / `ts-node` for dev, `tsc` for build)
- **HTTP Server**: Express.js
- **Database**: SQLite using `better-sqlite3` (storing `entities` and `observations`)
- **API Contract**: OpenAPI 3.0 (Swagger) specification defining REST endpoints
- **Real-Time Communication**: `ws` WebSocket server broadcasting telemetry updates to connected clients
- **Declarative Source Ingestion Engine**:
  - Reads YAML source configurations from `sources.d/`
  - Polls HTTP endpoints on configurable intervals
  - Supports JSON, GeoJSON, XML, and CSV parsing
  - Filters records and maps fields to standardized Entity and Observation schemas
  - Performs upsert/append operations in SQLite and emits real-time WebSocket events

### Frontend Stack
- **Build Tool**: Vite + React + TypeScript
- **State Management**: Redux Toolkit (RTK) & RTK Query
- **UI Component Library**: Material UI (MUI) dark theme
- **Visualization**: 3D Globe component (via `globe.gl` or Three.js / Canvas 3D) rendering position markers, trails, and metadata callouts
- **Post-Processing & Visual Filters**: Canvas / CSS overlays supporting retro CRT scanlines, FLIR thermal palette, and Night Vision green HUD modes

### Tooling & Automation
- **Makefile**: Unified build and development commands (`make dev`, `make build`, `make test`, `make lint`, `make format`)
- **Token Killer (RTK)**: Command wrapper enforcing `rtk` prefix for git, test, build, and file operations

---

## 2. Deliverables Structure

```
reconvillage-workshop/
├── AGENTS.md                                  # Instructions & tool context for AI agents
├── Makefile                                   # Command runner for development & testing
├── docs/
│   ├── INSTRUCTIONS.md                        # Master workshop prompt & outline
│   ├── PROMPT_1_PROJECT_SETUP.md              # Part 3 - Step 1 Prompt
│   ├── PROMPT_2_INGESTION_ENGINE.md           # Part 3 - Step 2 Prompt
│   ├── PROMPT_3_BACKEND_WEBSOCKET_API.md      # Part 3 - Step 3 Prompt
│   ├── PROMPT_4_FRONTEND_GLOBE_DASHBOARD.md   # Part 3 - Step 4 Prompt
│   ├── PROMPT_5_CINEMATIC_FILTERS_POLISH.md   # Part 3 - Step 5 Prompt
│   └── superpowers/
│       ├── specs/
│       │   ├── 01-project-setup-spec.md
│       │   ├── 02-ingestion-engine-spec.md
│       │   ├── 03-backend-websocket-api-spec.md
│       │   ├── 04-frontend-globe-dashboard-spec.md
│       │   └── 05-cinematic-filters-polish-spec.md
│       └── plans/
│           ├── 01-project-setup-plan.md
│           ├── 02-ingestion-engine-plan.md
│           ├── 03-backend-websocket-api-plan.md
│           ├── 04-frontend-globe-dashboard-plan.md
│           └── 05-cinematic-filters-polish-plan.md
└── skills/
    └── onboard-source/
        └── SKILL.md                            # Skill for creating new YAML source configs
```

---

## 3. Detailed Prompt Design (`PROMPT_1.md` – `PROMPT_5.md`)

Each prompt adheres to the **Universal Markdown Prompt Template**:
1. Persona
2. Core Task
3. Instructions & Constraints
4. Format Requirements
5. Analysis Steps
6. Input Data (Fenced)

### Step 1: `PROMPT_1_PROJECT_SETUP.md`
- **Goal**: Initialize workspace structure, TypeScript setup, Makefile, OpenAPI contract, and SQLite database connection & schema (`entities`, `observations`, `sources`).
- **Verification**: `make test` runs initial SQLite schema tests; `make dev` starts workspace TypeScript build.

### Step 2: `PROMPT_2_INGESTION_ENGINE.md`
- **Goal**: Implement the YAML Ingestion Engine (`sources.d/` directory loader, HTTP transport fetcher, JSON/GeoJSON/XML/CSV parser, record mapping to SQLite DB).
- **Included Source Definitions**:
  - `usgs_earthquakes.yaml` (GeoJSON summary feed)
  - `iss_position.yaml` (JSON telemetry API)
  - `adsb_military.yaml` (Military flight feed)
  - `safecast_radiation.yaml` (Radiation measurement feed)
- **Verification**: Engine unit tests validating YAML parsing, HTTP fetching mock, and SQLite record insertion.

### Step 3: `PROMPT_3_BACKEND_WEBSOCKET_API.md`
- **Goal**: Build Express.js REST API routes and `ws` WebSocket broadcast server.
- **Routes**:
  - `GET /api/sources`: List configured sources and status
  - `GET /api/entities`: Query active entities with category and spatial bounds filtering
  - `GET /api/observations`: Query historical position/telemetry observations
  - `WS /ws/telemetry`: Real-time WebSocket feed emitting live `entity_update` and `observation` payloads
- **Verification**: API Integration tests and WebSocket connection tests.

### Step 4: `PROMPT_4_FRONTEND_GLOBE_DASHBOARD.md`
- **Goal**: Create Vite + React + RTK Query + MUI dark UI with interactive 3D Globe visualization.
- **Key Components**:
  - `GlobeView`: Renders 3D Earth, entity point markers, trails, and altitude offsets.
  - `LayerControlPanel`: Checkbox panel to toggle OSINT data layers (satellites, flights, earthquakes, radiation).
  - `EntityDetailsDrawer`: Detailed HUD inspector displaying selected entity metadata.
  - `LiveTelemetryBanner`: Connection status and incoming message rate gauge.
- **Verification**: Vite dev server build and component tests.

### Step 5: `PROMPT_5_CINEMATIC_FILTERS_POLISH.md`
- **Goal**: Add visual post-processing modes, sound/visual indicators, and performance controls.
- **Features**:
  - Retro CRT scanlines overlay with CRT distortion.
  - Night Vision HUD mode (green monochrome, noise grain, dynamic crosshairs).
  - FLIR Thermal Mode (false-color heat map styling).
  - Filter mode switcher in top navigation bar.
- **Verification**: Full end-to-end production build (`make build`) and UI smoke test.

---

## 4. `AGENTS.md` Context & Guidelines

The root `AGENTS.md` file equips subagents and models with context on:
- **RTK Enforcement**: Standardizing commands using `rtk git status`, `rtk cargo test`, `rtk npm test`, `rtk read`, `rtk grep`, etc.
- **Superpowers Workflow**: Always reading specs, creating plans, and requesting review before execution.
- **Code Standards**: Strict TypeScript types, explicit error handling, modular node architecture, and proper cleanup of listeners/intervals.

---

## 5. Source Onboarding Skill (`skills/onboard-source/SKILL.md`)

A custom skill enabling agents to analyze an API endpoint URL and produce a valid YAML source file inside `sources.d/`.

- **Workflow**:
  1. Make an HTTP request to the target API endpoint.
  2. Detect response format (JSON, GeoJSON, XML, CSV).
  3. Identify primary record list path (`records_path`).
  4. Extract latitude, longitude, altitude, timestamp, and entity ID field paths.
  5. Generate formatted YAML config matching schema v2.
  6. Save output to `sources.d/<source_name>.yaml`.

---

## 6. Verification & Self-Review

- [x] **Placeholder Scan**: All prompt boundaries, schemas, and file paths are explicitly named.
- [x] **Internal Consistency**: Stack matches across prompts, specs, and AGENTS.md.
- [x] **Scope Check**: Broken down into 5 manageable 15-minute steps for a 75-minute workshop.
- [x] **Ambiguity Check**: Precise inputs, formats, and verification commands defined for each step.
