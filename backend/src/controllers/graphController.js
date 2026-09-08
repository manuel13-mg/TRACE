const pool = require('../db/pool');
const intel = require('../services/intelClient');
const graph = require('../services/graphService');
const audit = require('../services/auditService');
const { normalize } = require('../services/normalize');
const { asyncHandler, notFound, badRequest } = require('../lib/errors');

/**
 * Graph reads.
 *
 * Every handler tries intel-service first and falls back to the Postgres graph
 * (docs/PROJECT.md §F). The response carries `source` so the UI can show a
 * "live analysis unavailable" banner honestly — degrading silently would be
 * worse than degrading visibly, because an investigator needs to know whether
 * they are looking at freshly computed intelligence or the last known picture.
 *
 * The explainability endpoints below are the exception: they are answered from
 * Postgres unconditionally. `/why` has to derive its evidence from the same
 * graph the Explorer is rendering, and a proxied version could describe a
 * different one — an explanation that does not match the picture it explains is
 * worse than no explanation.
 */

const overview = asyncHandler(async (req, res) => {
  const { limit } = req.valid.query;

  const live = await intel.graphOverview(limit);
  if (live.ok) return res.json({ ...live.data, source: 'intel-service' });

  const data = await graph.overview({ limit });
  res.json({
    ...data,
    source: 'postgres-fallback',
    // `delegated` separates "this is where the maths lives" from "something
    // broke". Both fall back to Postgres, but only one of them warrants an
    // alarm in the UI — and calling a healthy service an outage is its own kind
    // of dishonesty.
    delegated: Boolean(live.delegated),
    degraded_reason: live.reason,
  });
});

const neighbors = asyncHandler(async (req, res) => {
  const { nodeId } = req.valid.params;
  const { depth, limit } = req.valid.query;

  const live = await intel.graphNeighbors(nodeId, depth, limit);
  if (live.ok) return res.json({ ...live.data, source: 'intel-service' });

  const data = await graph.neighbors(nodeId, { depth, limit });
  if (data.error) throw notFound('Node');
  res.json({
    ...data,
    source: 'postgres-fallback',
    delegated: Boolean(live.delegated),
    degraded_reason: live.reason,
  });
});

const cluster = asyncHandler(async (req, res) => {
  const { clusterKey } = req.valid.params;

  const live = await intel.graphCluster(clusterKey);
  if (live.ok) return res.json({ ...live.data, source: 'intel-service' });

  const data = await graph.cluster(clusterKey);
  if (!data) throw notFound('Cluster');
  res.json({
    ...data,
    source: 'postgres-fallback',
    delegated: Boolean(live.delegated),
    degraded_reason: live.reason,
  });
});

/**
 * GET /api/graph/why/:nodeId — docs/PLAN-V2-DATA-AND-INTEL.md §3.1.
 *
 * The answer to "why is this person flagged?", and the hardest question this
 * system has to survive. Always computed locally: the explanation and the graph
 * on screen must come from the same source or the explanation is worthless.
 */
const why = asyncHandler(async (req, res) => {
  const { nodeId } = req.valid.params;
  const explanation = await graph.why(nodeId);
  if (!explanation) throw notFound('Node');
  res.json({ ...explanation, source: 'postgres' });
});

/** GET /api/graph/path?from=&to= — §3.2. How two nodes connect, in fewest hops. */
const path = asyncHandler(async (req, res) => {
  const { from, to } = req.valid.query;
  if (from === to) throw badRequest('from and to must be different nodes');

  const result = await graph.path(from, to);
  if (result.error === 'unknown_from') throw notFound(`Node "${from}"`);
  if (result.error === 'unknown_to') throw notFound(`Node "${to}"`);
  res.json({ ...result, source: 'postgres' });
});

/** GET /api/graph/common?a=&b= — §3.2. What two nodes have in common. */
const common = asyncHandler(async (req, res) => {
  const { a, b } = req.valid.query;
  if (a === b) throw badRequest('a and b must be different nodes');

  const result = await graph.common(a, b);
  if (result.error === 'unknown_a') throw notFound(`Node "${a}"`);
  if (result.error === 'unknown_b') throw notFound(`Node "${b}"`);
  res.json({ ...result, source: 'postgres' });
});

/**
 * POST /api/graph/simulate-removal — the Fragmentation Simulator (innovation
 * layer).
 *
 * Accepts one or two node ids, removes them from a COPY of the live graph and
 * reports what happens to the organisation they belonged to: fragment count,
 * resilience delta, the subgraph before/after, and the new top-influence node
 * (the "who takes over" beat of the demo). The stored graph is never mutated —
 * a simulation, not an arrest.
 */
const simulateRemoval = asyncHandler(async (req, res) => {
  const { nodes: nodeIds } = req.valid.body;

  const result = await graph.simulateRemoval(nodeIds);
  if (result.error === 'unknown_node') throw notFound(`Node "${result.missing[0]}"`);

  res.json({ ...result, source: 'postgres' });
});

/**
 * POST /api/graph/intel-links — the intelligence-edge write path (innovation
 * layer).
 *
 * The complaint intake API can only create REPORTED_IN edges (an entity named
 * in a filing). The coordinator pattern the demo turns on lives in
 * entity_links — the seized-contact-list, telco and bank-KYC edges that reach
 * people no victim ever names — and until now nothing on the API could write
 * those. This closes that gap so the innovation dataset can be seeded through
 * the real pipeline rather than with direct SQL.
 *
 * ADMIN only, audited, and idempotent (ON CONFLICT DO NOTHING), because the
 * seed script may be re-run and a re-run must not duplicate the corpus.
 */
const intelLinks = asyncHandler(async (req, res) => {
  const { links } = req.valid.body;

  const result = await pool.withTransaction(async (client) => {
    const entityIds = new Map(); // `${type}::${normalized}` -> id
    const created = { links: 0, entities: 0 };

    for (const link of links) {
      const endpoints = [link.from, link.to];
      const ids = [];

      for (const ref of endpoints) {
        const norm = normalize(ref.type, ref.value);
        if (!norm) throw badRequest(`cannot normalise ${ref.type} "${ref.value}"`);
        const key = `${ref.type}::${norm}`;

        if (!entityIds.has(key)) {
          const up = await client.query(
            `INSERT INTO entities (entity_type, value, normalized_value, label, last_seen)
             VALUES ($1,$2,$3,$4, now())
             ON CONFLICT (entity_type, normalized_value)
               DO UPDATE SET label = COALESCE(entities.label, EXCLUDED.label),
                             last_seen = now()
             RETURNING id, (xmax = 0) AS inserted`,
            [ref.type, String(ref.value).slice(0, 255), norm, ref.label || null]
          );
          entityIds.set(key, up.rows[0].id);
          // xmax = 0 is Postgres' own answer to "did this row pre-exist".
          // COUNTING otherwise would double-report entities on a re-run.
          if (up.rows[0].inserted) created.entities += 1;
        }
        ids.push(entityIds.get(key));
      }

      // The upsert cannot tell us whether the row pre-existed, so count
      // entities honestly: only rows this transaction actually inserted.
      const ins = await client.query(
        `INSERT INTO entity_links (from_entity_id, to_entity_id, relationship, weight, source, note)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (from_entity_id, to_entity_id, relationship) DO NOTHING
         RETURNING id`,
        [ids[0], ids[1], link.relationship, link.weight ?? 1, link.source ?? 'INTEL', link.note || null]
      );
      if (ins.rowCount) created.links += 1;
    }

    return created;
  });

  graph.invalidate();

  await audit.log({
    actorId: req.user.id,
    action: 'GRAPH_INTEL_LINKED',
    entityType: 'graph',
    metadata: { links: result.links, entities: result.entities },
    ipAddress: audit.clientIp(req),
  });

  res.status(201).json({
    ...result,
    note: 'Intelligence edges written. The graph cache was refreshed.',
  });
});

/**
 * ADMIN only. Rebuilds Neo4j from Postgres and drops the local cache.
 *
 * Sends the corpus in chunks. A single body carrying 220 complaints and their
 * ~1,300 entity links is a few megabytes and one all-or-nothing HTTP call;
 * chunking keeps each request small and means a mid-run failure leaves a
 * partially rebuilt projection rather than nothing. That is the same tradeoff
 * the intel service already makes per-complaint, for the same reason.
 */
const REBUILD_CHUNK = 40;

const rebuild = asyncHandler(async (req, res) => {
  graph.invalidate();

  const corpus = await graph.projectionCorpus();
  const totals = { ingested: 0, nodes: 0, edges: 0, failed: 0 };
  let failure = null;

  for (let i = 0; i < corpus.length; i += REBUILD_CHUNK) {
    const chunk = corpus.slice(i, i + REBUILD_CHUNK);
    const live = await intel.ingestBulk({ source: 'postgres', complaints: chunk });

    if (!live.ok) { failure = live.reason; break; }
    totals.ingested += live.data.ingested ?? 0;
    totals.nodes += live.data.nodes ?? 0;
    totals.edges += live.data.edges ?? 0;
    totals.failed += live.data.failed ?? 0;
  }

  await audit.log({
    actorId: req.user.id,
    action: 'GRAPH_REBUILD',
    entityType: 'graph',
    metadata: { intel_ok: !failure, ingested: totals.ingested, reason: failure },
    ipAddress: audit.clientIp(req),
  });

  if (failure) {
    // The local cache was still dropped, so the fallback graph is fresh. 202
    // rather than 500: the part of the job we own succeeded.
    return res.status(202).json({
      rebuilt: 'postgres-fallback-only',
      reason: failure,
      partial: totals,
      note: totals.ingested
        ? `Neo4j went away after ${totals.ingested} complaints. Local graph cache cleared.`
        : 'Local graph cache cleared. Neo4j was not reachable.',
    });
  }

  res.json({ ...totals, complaints: corpus.length, source: 'intel-service' });
});

module.exports = {
  overview, neighbors, cluster, why, path, common, rebuild,
  simulateRemoval, intelLinks,
};
