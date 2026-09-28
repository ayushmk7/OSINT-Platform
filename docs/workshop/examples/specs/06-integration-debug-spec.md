# Technical Specification: 06 - Full-Stack Integration, Sanity Check & Debug

## 1. Overview
This specification defines the final integration and verification pass for the MK-OSINT
Platform. Unlike steps 1–5, it produces no new features — it **proves the assembled system works
end-to-end and fixes whatever does not.** It exists because unit tests passed while the running app
was broken; this step replaces "tests are green" with "the running system was observed working,"
using the Chrome DevTools MCP for all visual/runtime evidence and the `systematic-debugging` skill
for every fix.

---

## 2. Scope
- **In scope:** running the full stack, verifying the cross-cutting contracts (ports, WS path,
  category enum, dedup, wiring, z-index/visibility), fixing any defect found, and re-verifying.
- **Out of scope:** new product features. Any change here is a bug fix backed by a failing check.

---

## 3. Verification Matrix (acceptance criteria)

Each row is a check with an explicit, observable pass condition. A failing row is a defect to fix.

### 3.1 Portability & build
| Check | Pass condition |
|---|---|
| No `rtk` in committed files | `grep -rn "rtk" Makefile package.json */package.json` → 0 matches |
| Make targets | `make help/build/test/lint/format` exit 0 with `rtk` off `PATH`; `make dev` starts both servers |
| Strictness | `strict`, `noUnusedLocals`, `noUnusedParameters` = true; no `--passWithNoTests` |

### 3.2 Backend REST
| Check | Pass condition |
|---|---|
| Sources | `GET /api/sources` → `{ "sources": [...] }` |
| Entities | `GET /api/entities?category=aircraft` → wrapped, filtered |
| Observations | `GET /api/observations?entity_id=…` → wrapped |
| No leak | No response body contains a stack trace |

### 3.3 Ingestion & deduplication
| Check | Pass condition |
|---|---|
| Idempotent | `observations` ≈ `count(DISTINCT entity_id||timestamp)`; ratio bounded |
| Mode honored | scheduler reads `recording.mode`; idempotency test passes |
| Categories | `entities.category` ⊆ `{satellite, aircraft, geological, radiation, maritime}` |
| No (0,0) | no entity/observation at latitude 0 AND longitude 0 from a missing coordinate |

### 3.4 WebSocket
| Check | Pass condition |
|---|---|
| Connect | Network tab: `/ws/telemetry` socket opens (through Vite `/ws` proxy) |
| Initial | `initial_state` received; contains every category present in the DB |
| Live | `entity_update` frames arrive as entities move; no `observation` flood |

### 3.5 Globe (visual, Chrome DevTools)
| Check | Pass condition |
|---|---|
| Real map | Cesium canvas shows a real dark basemap (coastlines on zoom), not a fixed texture |
| All categories | ≥1 tactical silhouette billboard per live category — not only aircraft |
| Selection | click a marker → inspector opens; observation history loads over REST |

### 3.6 HUD / filters (visual, Chrome DevTools)
| Check | Pass condition |
|---|---|
| Header | one top bar; drawer button, title, connection chip, OFF/CRT/NVG/FLIR all visible & clickable |
| Drawer | drawer button opens the layer drawer |
| Filters | each mode toggles its overlay; globe still drags/zooms underneath |

### 3.7 Code quality
| Check | Pass condition |
|---|---|
| No empty catch | every `catch` logs context |
| No boundary `any` | Cesium/WS/ingestion are typed |
| No dead REST | RTK-Query hooks are actually consumed |
| Clean console | zero console errors on load and during interaction |

---

## 4. Method
For each failing row: reproduce → find root cause (`systematic-debugging`) → fix → re-verify.
Fixes must be minimal and targeted; never patch a symptom (e.g. never widen a `catch`, disable a
lint rule, or hardcode data to make a check pass).

## 5. Evidence & Reporting
Produce a pass/fail table matching §3, with Chrome DevTools screenshots for the globe (markers of
multiple categories), the header (all controls visible), and each filter overlay, plus the DB dedup
query output. List every fix applied with its root cause.

## 6. Definition of Done
- Every §3 row passes, with the required screenshots and a clean browser console.
- Every defect found is fixed and re-verified.
- The report is written and includes evidence.
