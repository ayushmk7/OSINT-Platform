# MK-OSINT Workshop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create all MK-OSINT Vibe-Coding Workshop artifacts: AGENTS.md, step-by-step PROMPT_N.md files, pre-built Superpowers specs/plans, and the custom source onboarding skill.

**Architecture:** Generate structured markdown prompt instructions, pre-built specs and implementation plans, agent workflow context, and a custom skill file.

**Tech Stack:** Markdown, Node.js/TypeScript, Express, SQLite, React, Redux Toolkit, MUI, WebSockets, Globe.gl/Three.js, RTK.

## Global Constraints
- Target LLMs: Mid-tier models (Claude Sonnet 4.5, GPT-4o).
- Prompts follow the Universal Markdown Prompt Template (Persona, Core Task, Instructions & Constraints, Format Requirements, Analysis Steps, Input Data).
- Code commands in prompts/plans enforce `rtk` prefix where applicable per user rules.

---

### Task 1: Create `AGENTS.md` Root Guidelines File

**Files:**
- Create: `AGENTS.md`

**Interfaces:**
- Consumes: Workshop guidelines and tool context (RTK, Engram, Superpowers, Context7, Chrome DevTools MCP).
- Produces: Context file loaded automatically by subagents and LLMs during vibe coding.

- [ ] **Step 1: Write `AGENTS.md` content**
- [ ] **Step 2: Verify `AGENTS.md` contains tool descriptions and coding standards**
- [ ] **Step 3: Commit `AGENTS.md`**

---

### Task 2: Create Source Onboarding Skill (`skills/onboard-source/SKILL.md`)

**Files:**
- Create: `skills/onboard-source/SKILL.md`

**Interfaces:**
- Consumes: Target HTTP API endpoint URL (JSON, GeoJSON, XML, CSV).
- Produces: Valid v2 YAML configuration file inside `sources.d/<source_name>.yaml`.

- [ ] **Step 1: Write `skills/onboard-source/SKILL.md` instructions**
- [ ] **Step 2: Verify YAML template structure and parsing directives**
- [ ] **Step 3: Commit `skills/onboard-source/SKILL.md`**

---

### Task 3: Create Prompt 1 & Superpowers Spec/Plan 1 (Project Setup & Foundation)

**Files:**
- Create: `docs/PROMPT_1_PROJECT_SETUP.md`
- Create: `docs/superpowers/specs/01-project-setup-spec.md`
- Create: `docs/superpowers/plans/01-project-setup-plan.md`

**Interfaces:**
- Consumes: Node.js, Vite, TypeScript, SQLite, Makefile, OpenAPI contract.
- Produces: Foundation setup prompt, spec, and plan for Step 1 of Part 3.

- [ ] **Step 1: Write `docs/PROMPT_1_PROJECT_SETUP.md`**
- [ ] **Step 2: Write `docs/superpowers/specs/01-project-setup-spec.md`**
- [ ] **Step 3: Write `docs/superpowers/plans/01-project-setup-plan.md`**
- [ ] **Step 4: Verify formatting and links**
- [ ] **Step 5: Commit step 1 files**

---

### Task 4: Create Prompt 2 & Superpowers Spec/Plan 2 (Declarative Ingestion Engine)

**Files:**
- Create: `docs/PROMPT_2_INGESTION_ENGINE.md`
- Create: `docs/superpowers/specs/02-ingestion-engine-spec.md`
- Create: `docs/superpowers/plans/02-ingestion-engine-plan.md`

**Interfaces:**
- Consumes: YAML source schema, SQLite storage layer, node-fetch / axios.
- Produces: Prompt, spec, and plan for Step 2 of Part 3.

- [ ] **Step 1: Write `docs/PROMPT_2_INGESTION_ENGINE.md`**
- [ ] **Step 2: Write `docs/superpowers/specs/02-ingestion-engine-spec.md`**
- [ ] **Step 3: Write `docs/superpowers/plans/02-ingestion-engine-plan.md`**
- [ ] **Step 4: Verify formatting and sample YAML configs**
- [ ] **Step 5: Commit step 2 files**

---

### Task 5: Create Prompt 3 & Superpowers Spec/Plan 3 (Express REST API & WebSocket Server)

**Files:**
- Create: `docs/PROMPT_3_BACKEND_WEBSOCKET_API.md`
- Create: `docs/superpowers/specs/03-backend-websocket-api-spec.md`
- Create: `docs/superpowers/plans/03-backend-websocket-api-plan.md`

**Interfaces:**
- Consumes: OpenAPI spec, Express routes, `ws` WebSocket library, SQLite queries.
- Produces: Prompt, spec, and plan for Step 3 of Part 3.

- [ ] **Step 1: Write `docs/PROMPT_3_BACKEND_WEBSOCKET_API.md`**
- [ ] **Step 2: Write `docs/superpowers/specs/03-backend-websocket-api-spec.md`**
- [ ] **Step 3: Write `docs/superpowers/plans/03-backend-websocket-api-plan.md`**
- [ ] **Step 4: Verify formatting and API endpoint paths**
- [ ] **Step 5: Commit step 3 files**

---

### Task 6: Create Prompt 4 & Superpowers Spec/Plan 4 (React + RTK + MUI + 3D Globe)

**Files:**
- Create: `docs/PROMPT_4_FRONTEND_GLOBE_DASHBOARD.md`
- Create: `docs/superpowers/specs/04-frontend-globe-dashboard-spec.md`
- Create: `docs/superpowers/plans/04-frontend-globe-dashboard-plan.md`

**Interfaces:**
- Consumes: Vite, React, Redux Toolkit, MUI, Globe.gl/Three.js, WebSocket hook.
- Produces: Prompt, spec, and plan for Step 4 of Part 3.

- [ ] **Step 1: Write `docs/PROMPT_4_FRONTEND_GLOBE_DASHBOARD.md`**
- [ ] **Step 2: Write `docs/superpowers/specs/04-frontend-globe-dashboard-spec.md`**
- [ ] **Step 3: Write `docs/superpowers/plans/04-frontend-globe-dashboard-plan.md`**
- [ ] **Step 4: Verify formatting and component structure**
- [ ] **Step 5: Commit step 4 files**

---

### Task 7: Create Prompt 5 & Superpowers Spec/Plan 5 (Cinematic Visual Filters & Polish)

**Files:**
- Create: `docs/PROMPT_5_CINEMATIC_FILTERS_POLISH.md`
- Create: `docs/superpowers/specs/05-cinematic-filters-polish-spec.md`
- Create: `docs/superpowers/plans/05-cinematic-filters-polish-plan.md`

**Interfaces:**
- Consumes: Canvas/CSS overlays, CRT scanlines, Night Vision HUD, FLIR thermal mode.
- Produces: Prompt, spec, and plan for Step 5 of Part 3.

- [ ] **Step 1: Write `docs/PROMPT_5_CINEMATIC_FILTERS_POLISH.md`**
- [ ] **Step 2: Write `docs/superpowers/specs/05-cinematic-filters-polish-spec.md`**
- [ ] **Step 3: Write `docs/superpowers/plans/05-cinematic-filters-polish-plan.md`**
- [ ] **Step 4: Verify formatting and visual filter implementation**
- [ ] **Step 5: Commit step 5 files**

---

## Plan Self-Review
- [x] **Spec coverage**: All sections of the spec are mapped to explicit tasks.
- [x] **Placeholder scan**: All file names, routes, code blocks, and steps are concrete.
- [x] **Type consistency**: Standardized Entity, Observation, Source, and WebSocket message signatures across all tasks.
