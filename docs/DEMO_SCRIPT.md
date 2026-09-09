# TRACE — Demo Script (both beats, verbatim)

Two back-to-back "wow" beats, both clickable in the live UI. Rehearse this
script, not the product's general capabilities — the numbers below were
captured from a real seeded run and will reproduce on a clean setup (see
"Preflight" for what must be running).

**Total runtime: ~6 minutes.** Beat 1 ~2.5 min, Beat 2 ~3 min.

---

## Preflight (do this before the judges arrive)

```bash
# 1. Containers (note the local override — native Postgres owns 5432/5433)
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d

# 2. Backend cold start (migrate + seed + scores + alerts + evidence + Neo4j)
cd backend && npm run setup        # load-reference will skip — dataset not shipped; that's fine

# 3. The innovation dataset (kingpin, lieutenant, aliases — through the live API)
cd backend && npm run seed:innovation

# 4. Services
cd intel-service && nohup .venv/Scripts/python -m uvicorn app.main:app --port 8000 &
cd blockchain && nohup npx hardhat node &      # then, once: npm run deploy:local
cd backend && npm start                        # :4000
cd frontend && npm run dev                     # :5173

# 5. Prove the chain is reachable
cd backend && npm run evidence-e2e   # optional rehearsal; all 22 checks must pass
```

Health check in the UI: the header strip shows four green dots
(DB · AI · Graph · Chain). If **Graph** is amber, Neo4j is down — the platform
deliberately still works (Postgres fallback), but restart it for the full demo.

**Login:** `investigator@argus.gov.in` / `argus2026` for most of the demo;
switch to **admin** (`admin@argus.gov.in` / `argus2026`) only for the tamper
button — it is ADMIN-only by design.

---

## BEAT 1 — Evidence tamper-detection (Evidence Locker)

**Where:** rail → **Custody → Evidence Locker** (`/evidence`)

| #   | Action                                                                                   | What the judge sees                                                                                                                                                                                                                 | Say                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Upload a file (drag one in; any `.txt`/`.png`/`.pdf` will do) via **Seal new evidence**. | "Hash, encrypt & anchor" — the SHA-256 of the plaintext is shown in full, in green.                                                                                                                                                 | "The digest is taken BEFORE encryption — that is the thing we seal on-chain, not the ciphertext."                                                                                                                                                                                                            |
| 2   | Wait for the anchor badge to flip **Pending → Anchored** (a few seconds).                | Anchor card appears: transaction hash, block number, timestamp, "View on the block explorer".                                                                                                                                       | "Uploads are never blocked by the chain — anchoring runs in the background. Here it landed in block N."                                                                                                                                                                                                      |
| 3   | Click **Verify integrity**.                                                              | Green verdict: **"Integrity confirmed"**, and the Chain of Custody panel grows entry 1: a PASS.                                                                                                                                     | "The file on disk decrypts, its digest recomputes, and it matches what the registry holds. That check is itself written on-chain."                                                                                                                                                                           |
| 4   | **(switch to admin login)** Click **Tamper (demo)** next to Verify. Confirm the dialog.  | Amber banner: **"Exhibit substituted on disk"**. The sealed digest above is unchanged.                                                                                                                                              | "This is the part you cannot usually demo. We now replace the stored file with different content — re-encrypted under the real key, so it still decrypts perfectly. Only the digest comparison can catch it. And it is ADMIN-only and dev-build-only; production refuses this action."                       |
| 5   | Click **Verify integrity** again.                                                        | **Red verdict: "INTEGRITY FAILED"**, both digests shown side by side (sealed vs recomputed). The custody trail grows entry 2, rendered louder than the pass: **"digest mismatch — exhibit altered at rest"**, permanently on-chain. | "Same file name, same row, decrypts cleanly — and the check fails, because the digest is the one thing that cannot be faked. Now the interesting part: that FAILURE is recorded on the chain, beside the earlier PASS, and neither of us can delete it. The record of the tampering outlives the tampering." |
| 6   | (optional, strong) Refresh the page and re-open the exhibit.                             | The red **INTEGRITY FAILED** entry is still first-class in the trail.                                                                                                                                                               | "A record that survives even the operator resetting their own database is the only kind worth anything in a custody dispute. That is the entire argument for a chain instead of a table."                                                                                                                    |

**Talking point to land:** _"Anyone can show a hash matching. The claim TRACE
makes is that a MISMATCH is recorded on the same terms as a match and cannot be
quietly removed."_

---

## BEAT 2 — Fragmentation Simulator (the new feature)

**Where:** rail → **Investigate → Fragmentation** (`/fragmentation`)

The planted dataset (see `backend/scripts/seed-innovation.js`) contains one
extra organisation, **DELTA**: three airtight cells, a **kingpin** who touches
all of them and is named in zero complaints, and a **hidden lieutenant** who
touches two cells — positioned so that if the kingpin disappears, she becomes
the most central node. All numbers below are from a real run.

| #   | Action                                                                                              | What the judge sees                                                                                                                                                                                                                                                                                                 | Say                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | On the canvas, click the **kingpin** — Karan Malhotra (or use **Pick by name** → "Karan Malhotra"). | Target 1 chip turns red; the node is marked.                                                                                                                                                                                                                                                                        | "This is our target. He appears in ZERO complaints — no victim ever named him. The graph found him anyway, because centrality reads structure, not filings."                                                                                                                                    |
| 2   | Click **Simulate removal**.                                                                         | The canvas swaps to the organisation BEFORE the strike, with the target in red.                                                                                                                                                                                                                                     | "This is the whole organisation as the graph knows it — handlers, mules, wallets, the three cells."                                                                                                                                                                                             |
| 3   | Click **After**.                                                                                    | **The network splits in two.** One fragment keeps two cells together, the third cell detaches. The big numbers read: **resilience 100% → 66.3%**, fragments 3, largest piece ~55 nodes. The right rail names the **new key connector: Sana Qureshi — surfaced.** The canvas auto-highlights her and her neighbours. | "Watch what one arrest buys you: the network does NOT collapse. It splits, absorbs the hit, and reorganises around someone new — the lieutenant, the person the old ranking kept in second place. One arrest is not the end of a network. It is the beginning of the next one."                 |
| 4   | Add a **second target**: click **Target 2…** → "Sana Qureshi".                                      | Two red target chips — the button now reads **"Simulate removal (combined)"**.                                                                                                                                                                                                                                      | "So the question becomes: what does it actually take to kill this network?"                                                                                                                                                                                                                     |
| 5   | Click **Simulate removal (combined)** → **After**.                                                  | **Full collapse**: every cell detaches — fragments 6, resilience **100% → 31.5%**, largest piece ~15 nodes. The stranded cash-out wallets show as isolated nodes.                                                                                                                                                   | "A coordinated strike — kingpin AND lieutenant together — takes it from one organisation to six disconnected pieces. The wallets are orphaned, unreachable, frozen by construction. This is the difference between an arrest and a takedown."                                                   |
| 6   | Reset (optional, strong closer) and re-run step 2 only.                                             | The 100% → 66% single-arrest view returns.                                                                                                                                                                                                                                                                          | "And this is why the simulator exists: an analyst can run an arrest a hundred times on a copy of the graph before anyone is taken into custody. Nothing we just did touched the live network — this is simulation, not action. It turns 'what if we move on them?' from a guess into a number." |

**Talking points to land:**

- _"The graph is never mutated — every simulation runs on a copy. Real data
  stays intact; the plan is the only thing that changes."_
- _"The new key connector is flagged 'surfaced': the ranking that existed
  before the strike did not have her on top. The system is telling you who
  comes next, not just who is on top now."_
- _"Two removals, three answers: 66% (single), 31% (combined), and the
  identity of the successor — before anyone has been arrested."_

---

## What not to do in front of judges

- **Do not** run `npm run verify-all` or `npm run db:reset` during the demo —
  `verify-determinism` re-seeds the database and would erase the DELTA dataset
  mid-show. To reset cleanly: `npm run db:reset -- --yes && npm run setup`,
  then `npm run seed:innovation`.
- **Do not** touch RBAC, encryption, or the auth code — out of scope, and
  they work.
- **Do not** deploy the chain anywhere but the local Hardhat node. The demo
  must not depend on internet access.
- The NCRB reference layer (Geo's "NCRB · OFFICIAL" badge) will show
  "not loaded" because the dataset directory isn't shipped. If asked, say so
  plainly: _"That layer needs the official NCRB exports, which we load from a
  licensed dataset — everything on screen besides that badge is the live
  pipeline."_ Or drop the CSVs into `crime-in-india-datasets/` beforehand and
  run `npm run load-reference`.

## Rehearsal checklist (last hour)

1. Full preflight from a cold state, once, and time it.
2. Beat 1 twice with the same file (re-upload — tamper is destructive by design).
3. Beat 2 twice: confirm the exact resilience numbers each run (they must be
   identical — the dataset is deterministic).
4. Test the projector resolution: the canvas should be legible from the back
   of the room at 1080p; if not, use the canvas zoom buttons and `Fit to view`.
5. Have `admin@argus.gov.in` logged in on a second tab for Beat 1 step 4.
