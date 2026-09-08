/**
 * Network Fragmentation Simulator — the innovation layer, and the demo beat
 * built on top of the existing graph (docs/AUDIT.md §6).
 *
 * Pick a node — the planted kingpin — simulate removing it, and the canvas
 * redraws the organisation the way it would actually break: fragments split
 * apart, a resilience number drops, and a new key connector surfaces. Then add
 * a second target and run a COMBINED strike, to show that one arrest is not
 * always enough — sometimes only a coordinated takedown collapses the network.
 *
 * Everything the page renders comes from POST /api/graph/simulate-removal,
 * which runs on a COPY of the live graph: nothing here can change the picture
 * an investigator is looking at anywhere else. The before/after subgraphs and
 * the numbers are the API's answer, never re-derived here.
 *
 * The canvas is GraphCanvas with a per-view `key`: the simulator swaps whole
 * graphs (browse → before → after) rather than growing one, so each swap
 * remounts and re-lays-out instead of piling new nodes at the origin.
 */

import { useMemo, useState } from 'react';
import {
  Crosshair, FlaskConical, RotateCcw, Unplug, X,
} from 'lucide-react';

import { graph as graphApi } from '@/api';
import { useApi } from '@/hooks/useApi';
import GraphCanvas from '@/components/graph/GraphCanvas';
import { Chip, Dot, Failed, Loading, Panel, Spinner } from '@/components/ui/Bits';
import { clusterColour, elide, entityLabel, num } from '@/utils/format';
import { cn } from '@/lib/utils';

/** Fragment colours — the categorical cycle, extended past the six clusters. */
const FRAGMENT_COLOURS = ['#a855f7', '#2e6ff2', '#10b981', '#f5a623', '#ec4899', '#06b6d4', '#ff8a5c', '#8b5cf6'];
const REMOVED_COLOUR = '#ff4757';

/** A small labelled stat, sized for a projector. */
function Stat({ label, value, unit, tone = 'default', hint }) {
  const tones = {
    default: 'text-txt', danger: 'text-danger', amber: 'text-amber', good: 'text-emerald',
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="lbl">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('mn text-[26px] leading-none font-semibold tracking-tight', tones[tone])}>{value}</span>
        {unit && <span className="mn text-[12px] text-faint">{unit}</span>}
      </div>
      {hint && <span className="truncate text-[10.5px] text-faint">{hint}</span>}
    </div>
  );
}

export default function Fragmentation() {
  const { data: overview, error, loading } = useApi(() => graphApi.overview(150), []);

  // Target selection. One node = single arrest; two = coordinated strike.
  const [targets, setTargets] = useState([]);
  const [result, setResult] = useState(null);
  const [view, setView] = useState('after'); // 'before' | 'after'
  const [running, setRunning] = useState(false);
  const [simError, setSimError] = useState(null);

  const nodeById = useMemo(() => {
    const m = new Map();
    for (const n of overview?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [overview]);

  // The picker list — highest-influence entities first, so the kingpin is one
  // click away even if a grey unclustered node is hard to find on canvas.
  const candidates = useMemo(
    () => (overview?.nodes ?? [])
      .filter((n) => n.type !== 'COMPLAINT')
      .sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0))
      .slice(0, 60),
    [overview]
  );

  const coordinated = targets.length === 2;

  function addTarget(id) {
    setSimError(null);
    setTargets((prev) => {
      if (prev.includes(id)) return prev;
      if (prev.length >= 2) return [prev[0], id];
      return [...prev, id];
    });
  }

  async function simulate() {
    if (!targets.length || running) return;
    setRunning(true);
    setSimError(null);
    try {
      const r = await graphApi.simulateRemoval(targets);
      setResult(r);
      setView('after');
    } catch (err) {
      setSimError(err.message);
    } finally {
      setRunning(false);
    }
  }

  // ---- the three canvas states -------------------------------------------
  // browse  : the full network; clicking a node picks a target.
  // before  : the affected organisation with the targets still in it.
  // after   : the fragments, each painted its own colour.
  const canvasState = !result
    ? { key: 'browse', nodes: overview?.nodes ?? [], edges: overview?.edges ?? [], selectedId: null }
    : view === 'before'
      ? {
          key: 'before',
          nodes: result.before.nodes.map((n) => ({
            ...n,
            // The targets are painted red — this is what the strike removes.
            colour: targets.includes(n.id) ? REMOVED_COLOUR : n.colour ?? clusterColour(n.cluster),
          })),
          edges: result.before.edges,
          selectedId: targets[0] ?? null,
        }
      : {
          key: 'after',
          nodes: result.after.nodes.map((n) => ({
            ...n,
            colour: FRAGMENT_COLOURS[(n.fragment ?? 0) % FRAGMENT_COLOURS.length],
          })),
          edges: result.after.edges,
          // Auto-select the new key player so the canvas lights up its
          // neighbourhood — the "who takes over" beat needs no clicking.
          selectedId: result.after.top?.id ?? null,
        };

  const beforeResilience = result?.before?.resilience;
  const afterResilience = result?.after?.resilience;
  const delta = result ? Number((afterResilience - beforeResilience).toFixed(1)) : null;
  const top = result?.after?.top;

  if (loading && !overview) {
    return <div className="p-4"><Loading label="Building the network" /></div>;
  }
  if (error && !overview) {
    return <div className="p-4"><Failed error={error} /></div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---- toolbar ---- */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-hair bg-deep px-3 py-2">
        <span className="flex items-center gap-1.5">
          <Unplug className="size-3.5 text-faint" strokeWidth={1.75} />
          <span className="mn text-[11px] text-dim">
            {result ? (
              <>
                <span className="text-txt">{num(result.scope.target_size)}</span>
                <span className="text-faint">-node organisation simulated</span>
              </>
            ) : (
              <>
                <span className="text-txt">{num(overview?.stats?.total_nodes ?? 0)}</span>
                <span className="text-faint"> nodes · click a node to mark it for removal</span>
              </>
            )}
          </span>
        </span>

        <div className="h-3.5 w-px bg-hair" />

        {/* Targets */}
        <div className="flex items-center gap-1.5">
          <span className="lbl">Target{coordinated ? 's' : ''}</span>
          {[0, 1].map((slot) => {
            const id = targets[slot];
            const node = id ? nodeById.get(id) : null;
            return (
              <span key={slot} className="flex items-center gap-1">
                <Chip
                  colour={REMOVED_COLOUR}
                  title={node ? `Remove ${node.label}` : 'Pick a target'}
                >
                  {node ? elide(node.label, 14, 10) : slot === 0 ? 'Target 1…' : 'Target 2…'}
                </Chip>
                {id && (
                  <button
                    type="button"
                    onClick={() => setTargets((prev) => prev.filter((t) => t !== id))}
                    title="Clear"
                    className="flex size-4 items-center justify-center rounded-[2px] text-faint transition-colors hover:bg-raise hover:text-danger"
                  >
                    <X className="size-2.5" strokeWidth={2.5} />
                  </button>
                )}
              </span>
            );
          })}

          <select
            value=""
            onChange={(e) => { if (e.target.value) addTarget(e.target.value); }}
            className="h-[24px] rounded-[3px] border border-hair bg-panel px-1.5 text-[11px] text-dim outline-none focus:border-blue"
          >
            <option value="">Pick by name…</option>
            {candidates.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} · {entityLabel(n.type)}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {result && (
            <>
              <button
                type="button"
                onClick={() => setView('before')}
                className={cn(
                  'h-[24px] rounded-[2px] border px-2 text-[11px] transition-colors',
                  view === 'before' ? 'border-blue text-txt' : 'border-hair text-dim hover:border-faint hover:text-txt'
                )}
              >
                Before
              </button>
              <button
                type="button"
                onClick={() => setView('after')}
                className={cn(
                  'h-[24px] rounded-[2px] border px-2 text-[11px] transition-colors',
                  view === 'after' ? 'border-blue text-txt' : 'border-hair text-dim hover:border-faint hover:text-txt'
                )}
              >
                After
              </button>
              <button
                type="button"
                onClick={() => { setResult(null); setView('after'); }}
                className="flex h-[24px] items-center gap-1.5 rounded-[2px] border border-hair px-2 text-[11px] text-dim transition-colors hover:border-faint hover:text-txt"
              >
                <RotateCcw className="size-2.5" strokeWidth={2} />
                Reset
              </button>
            </>
          )}
          <button
            type="button"
            onClick={simulate}
            disabled={!targets.length || running}
            className={cn(
              'flex h-[26px] items-center gap-1.5 rounded-[3px] px-3 text-[12px] font-medium transition-colors',
              'bg-blue text-white hover:bg-bluehi disabled:cursor-not-allowed disabled:opacity-40'
            )}
          >
            {running ? <><Spinner className="text-white" /> Simulating</> : (
              <>
                <FlaskConical className="size-3" strokeWidth={2} />
                Simulate removal{coordinated ? ' (combined)' : ''}
              </>
            )}
          </button>
        </div>
      </div>

      {simError && (
        <div className="shrink-0 border-b border-danger/25 bg-danger/[0.06] px-3 py-1.5 text-[11.5px] text-danger">
          {simError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ---- canvas ---- */}
        <div className="relative min-h-0 flex-1">
          <GraphCanvas
            key={canvasState.key}
            nodes={canvasState.nodes}
            edges={canvasState.edges}
            hiddenTypes={new Set()}
            selectedId={canvasState.selectedId}
            onSelect={(id) => {
              if (!result && id) addTarget(id);
            }}
            onExpand={() => {}}
          />

          {/* ---- legend / hint ---- */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[240px] flex-col gap-1.5 rounded-[3px] border border-hair bg-panel/85 px-2.5 py-2 backdrop-blur">
            {!result && (
              <>
                <span className="lbl">Simulator</span>
                <span className="text-[10.5px] leading-snug text-faint">
                  Click a node (or pick by name) to mark it for removal.
                  {coordinated ? ' Two targets = a combined strike.' : ''}
                </span>
              </>
            )}
            {result && view === 'before' && (
              <>
                <span className="lbl">Before the strike</span>
                <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
                  <Dot colour={REMOVED_COLOUR} size={6} /> target{coordinated ? 's' : ''} being removed
                </span>
              </>
            )}
            {result && view === 'after' && (
              <>
                <span className="lbl">Fragments</span>
                {result.after.fragments.map((f, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <Dot colour={FRAGMENT_COLOURS[i % FRAGMENT_COLOURS.length]} size={6} />
                    <span className="mn text-[10px] text-dim">{num(f.length)} nodes</span>
                  </span>
                ))}
                {result.after.isolated_nodes > 0 && (
                  <span className="text-[10px] text-faint">
                    …plus {result.after.isolated_nodes} stranded node{result.after.isolated_nodes === 1 ? '' : 's'} (cash-out wallets etc.)
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* ---- right rail: picker / verdict ---- */}
        <aside className="flex w-[330px] shrink-0 flex-col border-l border-hair bg-panel">
          {!result ? (
            <>
              <Panel title="How it works" flush className="min-h-0 flex-1">
                <div className="flex flex-col gap-2.5 overflow-y-auto p-3">
                  <p className="text-[12px] leading-relaxed text-dim">
                    The simulator removes the target from a <span className="text-txt">copy</span> of the
                    live graph and recomputes what happens to its organisation — how many pieces it
                    falls into, how much of it stays connected, and <span className="text-txt">who becomes the
                    key connector</span>.
                  </p>
                  <p className="text-[12px] leading-relaxed text-dim">
                    Nothing here changes the stored graph. An analyst can run an arrest a hundred
                    times before anyone is taken into custody.
                  </p>
                  <div className="rule my-0.5" />
                  <span className="lbl">Example</span>
                  <ol className="flex flex-col gap-1.5 text-[11.5px] leading-relaxed text-faint">
                    <li>1. Pick the kingpin (top influence).</li>
                    <li>2. Simulate the arrest — watch the network split.</li>
                    <li>3. Add a second target and strike together — the coordinated takedown.</li>
                  </ol>
                </div>
              </Panel>
              <div className="shrink-0 border-t border-hair p-2">
                <button
                  type="button"
                  onClick={simulate}
                  disabled={!targets.length || running}
                  className="flex h-8 w-full items-center justify-center gap-2 rounded-[3px] bg-blue text-[12.5px] font-medium text-white transition-colors hover:bg-bluehi disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {running ? <><Spinner className="text-white" /> Simulating…</> : (
                    <>
                      <Unplug className="size-3.5" strokeWidth={2} />
                      Simulate removal{coordinated ? ' (combined)' : ''}
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {/* The headline, in plain language — this is the sentence read
                  aloud on stage. */}
              <div
                className={cn(
                  'shrink-0 border-b px-3 py-3',
                  (delta ?? 0) < -20 ? 'border-danger/25 bg-danger/[0.06]' : 'border-amber/25 bg-amber/[0.06]'
                )}
              >
                <span className="lbl flex items-center gap-1.5">
                  {coordinated && (
                    <span className="flex items-center gap-1 rounded-[2px] border border-txt/25 px-1 text-[9px] font-semibold tracking-wider text-txt uppercase">
                      <Crosshair className="size-2" strokeWidth={2.5} /> Coordinated strike
                    </span>
                  )}
                  Verdict
                </span>
                <p className="mt-2 text-[14px] leading-relaxed font-medium text-txt">
                  {result.summary.narrative}
                </p>
                {top?.surfaced && (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-amber">
                    A node the old ranking kept in the background has taken over. One arrest is not
                    the end of the network — it is the beginning of the next one.
                  </p>
                )}
              </div>

              {/* The numbers. */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-4 border-b border-hair px-3 py-3">
                <Stat label="Resilience before" value={num(beforeResilience)} unit="%" />
                <Stat
                  label="Resilience after"
                  value={num(afterResilience)}
                  unit="%"
                  tone={(delta ?? 0) <= -20 ? 'danger' : 'amber'}
                  hint={`${delta > 0 ? '+' : ''}${delta} points`}
                />
                <Stat label="Fragments" value={num(result.after.fragment_count)} tone={(result.after.fragment_count ?? 0) > 1 ? 'danger' : 'good'} />
                <Stat label="Largest piece" value={num(result.after.largest_fragment)} unit="nodes" />
              </div>

              {/* Who takes over. */}
              {top ? (
                <div className="border-b border-hair px-3 py-3">
                  <span className="lbl">New key connector</span>
                  <div className="mt-2 flex items-center gap-2.5 rounded-[3px] border border-blue/25 bg-blue/[0.06] px-2.5 py-2">
                    <Dot colour="#5b93ff" size={8} pulse={top.surfaced} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-txt">{top.label}</p>
                      <p className="text-[10.5px] text-faint">
                        {entityLabel(top.type)} · influence {top.influence}
                      </p>
                    </div>
                    {top.surfaced && (
                      <span className="rounded-[2px] border border-amber/30 bg-amber/[0.08] px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider text-amber uppercase">
                        Surfaced
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
                    {top.surfaced
                      ? `Was not the most central node before the strike. The organisation's next-in-line stepped up.`
                      : 'Already the most central node; it remains so after the strike.'}
                  </p>
                </div>
              ) : (
                <div className="border-b border-hair px-3 py-3">
                  <p className="text-[12px] text-faint">No organisation remained to lead.</p>
                </div>
              )}

              {/* Removed targets. */}
              <div className="flex flex-col gap-1.5 px-3 py-3">
                <span className="lbl">Removed</span>
                {result.removed.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-[11.5px]">
                    <Dot colour={REMOVED_COLOUR} size={6} />
                    <span className="min-w-0 flex-1 truncate text-txt">{r.label}</span>
                    <span className="text-[10px] text-faint">{entityLabel(r.type)}</span>
                  </div>
                ))}
                <p className="mt-1 text-[10px] leading-relaxed text-faint">
                  Simulation on a copy of the graph — the live network is untouched. Source:{' '}
                  <span className="mn">{result.source}</span>
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}