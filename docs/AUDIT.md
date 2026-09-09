# TRACE — Threat Relationship Analysis and Connection Engine Environment & Capability Audit

Audit performed at the start of the innovation-layer sprint. Answers the five
questions the brief asks, plus a full environment report, so the rest of the
plan builds on what actually exists rather than on assumptions.

---

## 0. Environment status (booted and verified)

| Component                    | Status     | Notes                                                                               |
| ---------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| postgres (:5434 → container) | ✅ healthy | `argus-postgres` container, healthcheck green                                       |
| neo4j (:7474/:7687)          | ✅ healthy | `argus-neo4j` container, 1,268+ nodes after projection                              |
| intel-service (:8000)        | ✅ up      | FastAPI health endpoint responds; extraction path exercised                         |
| core API (:4000)             | ✅ up      | migrate + seed + scores + alerts + evidence + projection all ran                    |
| Hardhat chain (:8545)        | ✅ up      | `EvidenceRegistry` deployed locally at `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| frontend (:5173)             | ✅ up      | Vite dev server serving the app                                                     |

**Local port deviations (documented, not code changes):**

- This machine already runs two **native Postgres instances on host ports 5432
  and 5433** (their credentials are unknown and they are not this project's).
  The compose Postgres container is therefore exposed on **5434** via
  `docker-compose.local.yml` (gitignored; applied explicitly with
  `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d`).
  `backend/.env` points `DATABASE_URL` at 5434 to match.
- `backend/.env`, `backend/.env.example` is the template. `JWT_SECRET` and
  `EVIDENCE_ENCRYPTION_KEY` were generated fresh (never commit them).
- The intel-service venv lives at `intel-service/.venv` (Python 3.12 + spaCy
  `en_core_web_sm`).

**One genuine gap — NCRB reference data is not loaded.** `npm run
load-reference` reads a real `crime-in-india-datasets/` directory of NCRB
exports (District-wise IPC CSVs + `31_Serious_fraud.csv`) that is **not
shipped in this repo and not present on disk**. Every smoke check that touches
`/api/reference/*` and `/api/geo/states` (the `NCRB · OFFICIAL` layer) fails
for exactly this reason; the UI degrades honestly (`Admin → reference_data:
not loaded`). This does not affect the graph, evidence, or alert layers. Fix:
drop the NCRB CSVs into `<repo>/crime-in-india-datasets/` and re-run
`npm run load-reference` — the loader, column matcher and rollup skip are
already written and unit-tested.

**Verification performed during this audit:**

- `docker-compose up -d`: both Postgres and Neo4j reported healthy. Because this
  machine already has a native Postgres listener on `5432`, the documented
  `docker-compose.local.yml` overlay was also required so the backend could use
  project Postgres on `5434`.
- `backend/npm run test:unit`: 36 passed.
- `backend/npm run evidence-e2e`: 22 passed, including anchor, verify, tamper,
  permanent on-chain failure recording, envelope-swap detection, and RBAC.
- `backend/npm run seed:innovation`: 14 passed. The live API produced 18
  complaints, resolved the planted aliases, and verified the planted topology:
  3 fragments and 66.3% resilience after one removal; 6 fragments and 31.5%
  after the coordinated removal.
- `frontend` Vite, `intel-service` FastAPI, backend API, and Hardhat all
  responded on their documented local ports.

`backend/npm run setup` completes migrations, the synthetic seed, scoring,
alerts, evidence seeding, and Neo4j projection, but exits at `load-reference`
when the unshipped NCRB directory is absent. The non-reference setup stages
were run individually and completed. Evidence seeding must run after the local
Hardhat node and contract deployment; otherwise anchors remain pending or fail.

**Earlier verification record retained for comparison:**

```
backend: npm run verify-all
  → 38 passed, 5 failed   (the 5 = reference/geo, single root cause above)
backend: node scripts/evidence-e2e.js
  → All 22 checks passed — tamper was detected and permanently recorded.
```

---

## 1. What the existing routes actually do

All routes live in one file — `backend/src/routes/index.js` — with zod schemas
declared at the router (validation never happens inside handlers; unvalidated
fields are simply absent from `req.valid`). Response shapes are frozen in
`docs/API.md`.

| Route group                                                          | What it does                                                                                                                                                                                                                                               | Request → response shape                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /api/complaints`                                               | **The live intake moment.** File → extract (intel-service first, Express regex fallback) → canonicalise → upsert entities → link `REPORTED_IN` → invalidate graph cache → fire-and-forget Neo4j ingest + alert rules. All in one request, `<3s` budget.    | `{complaint, entities[], linked_count, cluster, extraction:{tier, degraded, count}}` |
| `GET /api/complaints[,/:id]`                                         | List with filters (state/category/status/cluster/q) + page; detail returns entities, shared-entity linked complaints, cluster card.                                                                                                                        | `{complaints[], total, has_more}` / `{complaint, entities[], linked[], cluster}`     |
| `GET /api/entities[,/:id][,/why][,/osint]`                           | Read-only entity layer over Postgres. `/why` = the explainability panel (bridge paths, removal test, rank, never-named line).                                                                                                                              | `{entities[], total}` / `{entity, complaints[], links[], node_id}`                   |
| `POST /api/graph/rebuild` (ADMIN)                                    | Rebuilds the Neo4j projection from the Postgres corpus in chunks of 40, then drops the local cache. `202` + `rebuilt:'postgres-fallback-only'` if Neo4j goes away mid-run.                                                                                 | `{ingested, nodes, edges, complaints, source}`                                       |
| `POST /api/analytics/run` (ADMIN/ANALYST)                            | Recomputes influence (50/50 PageRank + betweenness) and risk (declared 4-weight policy), **persists them onto `entities`**, invalidates cache. intel-service answers 501 by design → Express always owns this maths.                                       | `{nodes_scored, entities_scored, top_influence, top_risk, duration_ms, source}`      |
| `GET /api/graph/*` (overview, neighbors, cluster, why, path, common) | Graph reads. intel-service 501s all of them → Express computes over Postgres and tags `source:'postgres-fallback'` + `delegated:true` so the UI knows "by design, nothing broken".                                                                         | node/edge payloads, Cytoscape-ready, not reshaped by the frontend                    |
| `POST /api/evidence/*`                                               | Upload (hash SHA-256 of plaintext → encrypt AES-256-GCM with row-bound AAD → async anchor), verify (recompute vs on-chain digest), reanchor, download (JWT-gated, `application/octet-stream` always), history, integrity-sweep, chain status/transactions. | see `docs/API.md` §evidence                                                          |
| alerts / geo / money / timeline / admin                              | Threat feed (generated by rule engine that stores its own SQL), synthetic geo layer, Sankey money traces, audit timeline, service board.                                                                                                                   | —                                                                                    |

## 2. Entity resolution: identifier-level, not fuzzy

Resolution exists and is the correlation engine's backbone, but it is
**canonicalisation, not fuzzy matching**:

- `backend/src/services/normalize.js` collapses surface variation per type:
  phones (`+91`/`0`/spaces/dashes → 10 digits), UPI/email/wallet case,
  EVM checksum casing, bank accounts (digits only, spaces/dashes dropped),
  Telegram `@`+case, names/places (lowercase, whitespace-collapsed).
- `entities` has `UNIQUE (entity_type, normalized_value)` as the dedup
  backstop; complaint intake upserts `ON CONFLICT`, so two complaints naming
  `+91 98765 43210` and `9876543210` resolve to **one** node and link.
- `intel-service/app/normalize.py` mirrors these rules (both sides must agree;
  the unit tests pin them).
- **Not present:** fuzzy/typo-tolerant alias merging (e.g. `Vikram Rathor` vs
  `Vikram Rathore`), cross-type identity (a phone vs an email for the same
  person). Nothing in the codebase claims to do this.

So the "3–4 deliberate alias entries" from the brief should be planted as
**surface-form variants of the same identifier across complaints** — the thing
the pipeline already proves live.

## 3. Graph algorithms: JavaScript over Postgres (not Python/NetworkX)

- The algorithms live in **`backend/src/services/graphAlgos.js`**: undirected
  PageRank (power iteration), Brandes betweenness, connected components,
  label-propagation communities (the Louvain stand-in), shortest path,
  bridge-paths-through, influence blend (50/50, deliberately untuned).
- `graphService.js` loads the whole graph (~1,200 nodes, ~1,600 edges) from
  Postgres, computes once, caches (60s TTL) with a single-flight guard.
- **There is no Python graph implementation.** The docker-compose comment
  says "we run Louvain and PageRank in NetworkX on the Python side", but
  `intel-service/app/main.py` documents the _opposite_, final decision:
  `/analytics/run` and `/graph/*` return **501 deliberately**, because two
  implementations of the same centrality maths could silently disagree about
  who the coordinator is. Neo4j is a projection only (ingest/rebuild).
- `verify-plant.js` proves the planted coordinators rank #1 by influence, and
  that removing a coordinator fragments the network. This is the layer the
  Fragmentation Simulator builds on.

## 4. Evidence e2e: works end-to-end, tamper recorded permanently

`backend/scripts/evidence-e2e.js` ran successfully on this clean setup —
**all 22 checks passed**:

```
upload → server hashes plaintext correctly → anchor starts PENDING
→ anchor reaches ANCHORED (tx on-chain) → verify PASSES
→ exhibit substituted on disk (valid ciphertext, same row/AAD)
→ verify FAILS with "digest mismatch — exhibit altered at rest"
→ failure permanently on-chain beside the earlier PASS
→ cross-row envelope swap also fails (AAD binding)
→ ANALYST gets 403 on raw evidence download (RBAC intact)
```

The **UI has** upload / verify / custody-trail (failures rendered louder than
passes) in `EvidenceLocker`, plus a development-only ADMIN "Tamper (demo)"
action. The e2e script remains useful as an automated proof, while the UI
provides the click-through demonstration path.

## 5. Frontend state: 13 pages, all wired to real data

`frontend/src/pages/`: Login, Dashboard, NetworkExplorer (Cytoscape + fCoSE,
the centrepiece), Complaints, ComplaintDetail, MoneyFlow (Sankey), ThreatFeed,
Timeline, Networks (+ cluster detail), GeoIntelligence (map), EvidenceLocker,
Admin. Design system is hand-rolled shadcn-flavoured Tailwind (components/ui),
with shared `Bits`, `format.js` (cluster colours stable across pages), `api/`
(named functions per endpoint), `hooks/useApi`.

The Fragmentation Simulator is implemented in both the backend and frontend.
It generalizes the single-node removal test from `/api/graph/why/:nodeId` to
one- or two-node simulations over a copy of the cached graph.

---

## 6. Gap summary → what the sprint builds

| #   | Brief item                          | Status     | Action                                                                                                                                                                                                                        |
| --- | ----------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fragmentation Simulator backend     | ✅ complete | `POST /api/graph/simulate-removal` uses the cached graph, operates on a copy, and reports fragments, resilience, and the successor node |
| 2   | Fragmentation Simulator frontend    | ✅ complete | `/fragmentation` supports node selection, before/after rendering, plain-language summaries, and combined two-node removal |
| 3   | Kingpin + hidden-lieutenant pattern | ✅ complete | `seed:innovation` plants the DELTA topology, alias variants, Karan Malhotra, and Sana Qureshi |
| 4   | Seed through the live ingestion API | ✅ complete | Complaints use `POST /api/complaints`; intelligence relationships use `POST /api/graph/intel-links` |
| 5   | Tamper-detection clickable in UI    | ✅ complete | Evidence Locker provides the development-only ADMIN tamper action, verification, and custody trail |
| 6   | NCRB reference layer                | ⚠️ gap     | Dataset absent from this machine; loader and UI fallback are implemented and documented |
