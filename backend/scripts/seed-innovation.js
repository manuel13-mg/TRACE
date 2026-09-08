#!/usr/bin/env node
/**
 * Innovation-layer demo dataset — seeded through the LIVE API.
 *
 *   node scripts/seed-innovation.js [baseUrl]
 *
 * Plants CLUSTER DELTA, the organisation behind the Fragmentation Simulator
 * demo, by exercising the same endpoints the product uses — never by writing
 * SQL. That is the point: what the judges watch has been through the real
 * pipeline (extract → canonicalise → link → graph), so it is a demo of the
 * system, not of a script.
 *
 *   complaints  → POST /api/complaints   (extraction + REPORTED_IN edges)
 *   intel edges → POST /api/graph/intel-links (seized-contact-list / KYC edges)
 *
 * WHAT IS PLANTED
 * ---------------
 * Three airtight cells (D1, D2, D3), each with its own handlers, UPI ids, mule
 * accounts, cash-out wallet and Telegram group — the same cell discipline as
 * the main corpus, so nothing is shared between cells except the two people at
 * the top.
 *
 *   kingpin    Karan Malhotra  — touches ALL three cells. Never named in a
 *                                complaint. The graph's top-influence node.
 *   lieutenant Sana Qureshi    — touches cells D1 and D2 only. Moderately
 *                                central while the kingpin is present; THE
 *                                most central node of the largest fragment the
 *                                moment he is removed.
 *
 * The topology is built so the two demo beats land, and both are planted
 * deliberately, not hoped for:
 *
 *   beat 1  remove the kingpin alone  → D3 detaches, DELTA splits in two
 *            (100% → ~66% resilience), and Sana Qureshi surfaces as the new
 *            key connector. One arrest is not enough.
 *   beat 2  remove kingpin + lieutenant together → all three cells detach
 *            (100% → ~32%). A coordinated strike is what actually collapses it.
 *
 * ALIASES — 4 pairs of surface-form variants of the same identifier, written
 * into different complaints so entity resolution has something to prove:
 *
 *   D1  handler phone   "+91 98765 43210"  vs  "98765-43210"
 *   D1  handler phone   "09876543210"      (a third form, same number)
 *   D2  UPI handle      "RAHUL.MEHTA@OKHDFCBANK"  vs  lowercase
 *   D3  handler email   "Sana.Khan@Gmail.COM"  vs  lowercase
 *
 * Every pair must extract from the narrative AND normalise to the same entity
 * — that is the pipeline doing the resolving, live.
 *
 * SAFETY
 * ------
 * The script is idempotent: if the DELTA kingpin already exists it prints a
 * short message and exits 0 rather than duplicating the organisation. All
 * identifiers are FICTION (generated deterministically, no real data). To
 * start over: `npm run db:reset -- --yes && npm run setup`, then re-run.
 */

const fetch = globalThis.fetch;

const BASE = process.argv[2] || process.env.ARGUS_URL || 'http://localhost:4000';
const ADMIN = { email: 'admin@argus.gov.in', password: 'argus2026' };

let token = null;
const failures = [];
let pass = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { failures.push(`${name} — ${detail || ''}`); console.log(`  FAIL  ${name}  ${detail || ''}`); }
};

async function api(method, path, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same seed, same corpus, rehearsable demo.
// ---------------------------------------------------------------------------
let _s = 20260421;
function rnd() {
  _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const mobile = () => `${pick(['6', '7', '8', '9'])}${String(int(0, 999999999)).padStart(9, '0')}`;
const FIRST = ['Arjun', 'Rahul', 'Sameer', 'Rohit', 'Neha', 'Priya', 'Amit', 'Kavita', 'Manish', 'Deepa', 'Sanjay', 'Ritu'];
const LAST = ['Mehta', 'Sharma', 'Verma', 'Nair', 'Iyer', 'Kulkarni', 'Bose', 'Chopra', 'Das', 'Pillai', 'Reddy', 'Gill'];
const usedNames = new Set();
/**
 * A name guaranteed unique across the whole corpus.
 *
 * The cells must stay AIRTIGHT — a name that happens to repeat across two
 * cells would become a shared PERSON node, and a shared node is a path between
 * cells that does not run through the kingpin. The main corpus avoids this with
 * random email suffixes; here it is prevented structurally.
 */
function personName() {
  let name;
  do { name = `${pick(FIRST)} ${pick(LAST)}`; } while (usedNames.has(name));
  usedNames.add(name);
  return name;
}
const accountNo = () => String(int(10000000000, 99999999999));
const ethWallet = () => `0x${Array.from({ length: 40 }, () => '0123456789abcdefABCDEF'[Math.floor(rnd() * 22)]).join('')}`;
const BANKS = [
  ['HDFC Bank', 'HDFC000'],
  ['ICICI Bank', 'ICIC000'],
  ['State Bank of India', 'SBIN000'],
  ['Axis Bank', 'UTIB000'],
  ['Punjab National Bank', 'PUNB000'],
];
const ifsc = (code) => `${code}${String(int(100000, 999999))}`;

const amount = () => (int(5, 99) * 500) + (int(10, 60) * 5000);

// ---------------------------------------------------------------------------
// DELTA cells
// ---------------------------------------------------------------------------

/** One cell of the planted organisation. Values are generated once and reused
 *  so the same identifier surfaces across that cell's complaints. */
function makeCell(tag) {
  const handlerA = { name: personName(), phone: mobile() };
  const handlerB = { name: personName(), phone: mobile() };
  let upiA = `${pick(['rahul', 'sameer', 'arjun', 'neha', 'manish', 'kavita'])}.${pick(['mehta', 'sharma', 'nair', 'iyer', 'gill', 'das'])}@okhdfcbank`;
  const upiB = `${pick(['rohit', 'priya', 'amit', 'deepa', 'sanjay', 'ritu'])}.${pick(['verma', 'kulkarni', 'bose', 'chopra', 'reddy', 'pillai'])}@oksbi`;

  // The alias targets get CANONICAL values here, and complaints write them in
  // their surface forms. This is what makes the alias entity the SAME node the
  // intel edges connect to — the alias is one entity, not two that happen to
  // look alike.
  if (tag === 'D1') handlerA.phone = '9876543210';
  if (tag === 'D2') upiA = 'rahul.mehta@okhdfcbank';
  if (tag === 'D3') handlerA.email = 'sana.khan@gmail.com';

  return {
    tag,
    handlers: [handlerA, handlerB],
    upis: [upiA, upiB],
    mules: Array.from({ length: 3 }, () => {
      const [bankName, code] = pick(BANKS);
      return { account: accountNo(), bankName, ifsc: ifsc(code) };
    }),
    wallet: ethWallet(),
    telegram: `@delta_${tag.toLowerCase()}_desk`,
    // Alias surface forms — see the module header. Each pair (or triple)
    // normalises to the SAME entity, proving resolution through the API.
    aliases: {
      D1: {
        kind: 'PHONE',
        label: 'handler phone "9876543210"',
        // Three complaints, three surface forms of one number.
        forms: ['+91 98765 43210', '98765-43210', '09876543210'],
      },
      D2: {
        kind: 'UPI',
        label: 'UPI "rahul.mehta@okhdfcbank"',
        forms: ['RAHUL.MEHTA@OKHDFCBANK', 'rahul.mehta@okhdfcbank'],
      },
      D3: {
        kind: 'EMAIL',
        label: 'email "sana.khan@gmail.com"',
        forms: ['Sana.Khan@Gmail.COM', 'sana.khan@gmail.com'],
      },
    }[tag],
  };
}

const CELLS = ['D1', 'D2', 'D3'].map(makeCell);

const KINGPIN = { name: 'Karan Malhotra' };
const LIEUTENANT = { name: 'Sana Qureshi' };

/** One complaint narrative for a cell. `aliasForm` is the surface variant of
 *  the cell's alias identifier this filing should use. */
function narrativeFor(cell, complaintIdx, aliasForm) {
  const handler = cell.handlers[complaintIdx % 2];
  const upi = cell.upis[complaintIdx % 2];
  const mule = cell.mules[complaintIdx % 3];
  const amt = amount();

  // The alias identifier is written in its surface form for THIS complaint;
  // every other identifier uses its canonical form.
  const handlerPhone = aliasForm ?? handler.phone;
  const upiText = cell.aliases.kind === 'UPI' && aliasForm ? aliasForm : upi;
  const handlerEmail = cell.aliases.kind === 'EMAIL' && aliasForm ? aliasForm : (handler.email || null);

  const parts = [
    `I received a call from ${handler.name} at ${handlerPhone} claiming my mutual fund`,
    `units were under SEBI investigation. ${handler.name} said I must transfer funds to`,
    `a "safe escrow" account ${mule.account} at ${mule.bankName} (IFSC ${mule.ifsc})`,
    `or face attachment proceedings. He directed payments via UPI ${upiText} and asked`,
    `me to join the Telegram group ${cell.telegram} for updates. I paid ₹${amt.toLocaleString('en-IN')}`,
    `in two instalments of ₹${(amt / 2).toLocaleString('en-IN')} each.`,
  ];
  if (handlerEmail) {
    parts.push(`He told me to email my statements to ${handlerEmail} for the "audit".`);
  }
  parts.push('Later the group went silent and the number was unreachable.');
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nARGUS innovation dataset → ${BASE}\n`);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN),
  }).then((r) => r.json());
  if (!login.token) { console.error('  login failed:', login.error || login); process.exit(1); }
  token = login.token;
  check('admin login', true);

  // Idempotency: the kingpin entity exists ⇒ this organisation is already seeded.
  const probe = await api('GET', `/api/entities?q=${encodeURIComponent(KINGPIN.name.split(' ')[0])}&limit=1`);
  const already = probe.body?.entities?.some(
    (e) => e.entity_type === 'PERSON' && e.value.toLowerCase().includes(KINGPIN.name.split(' ')[0].toLowerCase())
  );
  if (already) {
    console.log('\n  DELTA already seeded — nothing to do. (To reseed from scratch:\n  npm run db:reset -- --yes && npm run setup, then re-run this script.)\n');
    process.exit(0);
  }

  // --- complaints through the live intake --------------------------------
  let filed = 0;
  let extracted = 0;
  for (const cell of CELLS) {
    for (let i = 0; i < 6; i++) {
      // Alias surface forms: the first one/two/three filings of a cell use the
      // alias variants instead of the canonical value.
      let aliasForm = null;
      if (cell.aliases.kind === 'PHONE' && i < cell.aliases.forms.length) aliasForm = cell.aliases.forms[i];
      if (cell.aliases.kind === 'UPI' && i < 2) aliasForm = cell.aliases.forms[i];
      if (cell.aliases.kind === 'EMAIL' && i < 2) aliasForm = cell.aliases.forms[i];

      const victim = personName();
      const payload = {
        victim_name: victim,
        victim_phone: mobile(),
        // A random suffix, like the main corpus: two complaints must never be
        // bridged by a coincidentally-identical victim email. Victims are
        // leaves — they link one complaint, and that is all.
        victim_email: `${victim.toLowerCase().replace(/\s+/g, '.')}${int(1, 999)}@gmail.com`,
        narrative: narrativeFor(cell, i, aliasForm),
        scam_category: i % 2 ? 'UPI_FRAUD' : 'INVESTMENT_SCAM',
        amount_inr: amount(),
        state: pick(['Maharashtra', 'Karnataka', 'Delhi', 'Rajasthan', 'Tamil Nadu']),
        district: pick(['Mumbai', 'Bengaluru', 'New Delhi', 'Jaipur', 'Chennai']),
      };
      const res = await api('POST', '/api/complaints', payload);
      if (res.status !== 201) {
        check(`file complaint ${cell.tag}-${i + 1}`, false, `${res.status} ${res.body?.error || ''}`);
        continue;
      }
      filed++;
      extracted += res.body?.extraction?.count ?? 0;
      if (!res.body?.extraction?.tier) {
        check('extraction reported a tier', false, 'missing extraction.tier');
      }
    }
  }
  check(`filed ${filed} complaints through POST /api/complaints`, filed === 18, `${filed}/18`);
  check('extraction ran on every filing (live pipeline)', extracted > 0, `extracted ${extracted} entities total`);

  // --- intelligence edges through the new endpoint ------------------------
  const links = [];
  for (const cell of CELLS) {
    for (const h of cell.handlers) {
      links.push({
        from: { type: 'PHONE', value: h.phone, label: `Caller ${cell.tag} — ${h.name}` },
        to: { type: 'PERSON', value: KINGPIN.name, label: KINGPIN.name },
        relationship: 'COMMUNICATED_WITH',
        weight: 4, source: 'SEIZURE',
        note: 'contact list recovered from seized handset',
      });
    }
    links.push({
      from: { type: 'PERSON', value: KINGPIN.name, label: KINGPIN.name },
      to: { type: 'WALLET', value: cell.wallet, label: `Cell ${cell.tag} cash-out` },
      relationship: 'OWNS', weight: 5, source: 'INTEL',
      note: 'exchange KYC resolves the wallet to one identity',
    });
  }
  for (const cell of CELLS.slice(0, 2)) {
    for (const h of cell.handlers) {
      links.push({
        from: { type: 'PHONE', value: h.phone, label: `Caller ${cell.tag} — ${h.name}` },
        to: { type: 'PERSON', value: LIEUTENANT.name, label: LIEUTENANT.name },
        relationship: 'COMMUNICATED_WITH',
        weight: 4, source: 'SEIZURE',
        note: 'second-layer contact list — field coordinators',
      });
    }
    links.push({
      from: { type: 'PERSON', value: LIEUTENANT.name, label: LIEUTENANT.name },
      to: { type: 'WALLET', value: cell.wallet, label: `Cell ${cell.tag} cash-out` },
      relationship: 'OWNS', weight: 4, source: 'INTEL',
    });
  }

  const linkRes = await api('POST', '/api/graph/intel-links', { links });
  check('intel links written through POST /api/graph/intel-links',
    linkRes.status === 201 && linkRes.body?.links === links.length,
    `${linkRes.status} ${JSON.stringify(linkRes.body ?? linkRes.body?.error)}`);
  check('kingpin + lieutenant created as PERSON entities',
    linkRes.body?.entities >= 2, `created ${linkRes.body?.entities} entities`);

  // --- verify the planted pattern through the live simulator ---------------
  console.log('\n  -- verifying the planted topology through the API --\n');

  const kingpinId = `person:${KINGPIN.name.toLowerCase()}`;
  const lieutenantId = `person:${LIEUTENANT.name.toLowerCase()}`;

  const single = await api('POST', '/api/graph/simulate-removal', { nodes: [kingpinId] });
  check('simulate-removal answers for the kingpin', single.status === 200, single.status);
  const s = single.body;
  check('removing the kingpin fragments DELTA', (s?.after?.fragment_count ?? 0) >= 2,
    `${s?.after?.fragment_count} fragments`);
  check('resilience drops (single arrest is not enough)',
    (s?.after?.resilience ?? 100) < 90, `${s?.after?.resilience}%`);
  check('the lieutenant surfaces as the new key connector',
    s?.after?.top?.id === lieutenantId, `top was ${s?.after?.top?.id}`);
  check('that is a takeover, not a re-affirmation', s?.after?.top?.surfaced === true);
  check('the kingpin led before the removal', s?.before?.top?.id === kingpinId,
    `before-top was ${s?.before?.top?.id}`);

  const combo = await api('POST', '/api/graph/simulate-removal', { nodes: [kingpinId, lieutenantId] });
  check('combined removal answers', combo.status === 200, combo.status);
  const c = combo.body;
  check('combined removal collapses DELTA into 3+ fragments',
    (c?.after?.fragment_count ?? 0) >= 3, `${c?.after?.fragment_count} fragments`);
  check('combined removal drops resilience far below the single arrest',
    (c?.after?.resilience ?? 100) < (s?.after?.resilience ?? 100) - 20,
    `${c?.after?.resilience}% vs ${s?.after?.resilience}%`);

  // --- report --------------------------------------------------------------
  console.log(`\n${'='.repeat(64)}`);
  console.log('\n  DELTA planted. Demo numbers (single / combined):');
  console.log(`    fragments      ${s?.after?.fragment_count} / ${c?.after?.fragment_count}`);
  console.log(`    resilience     ${s?.after?.resilience}% / ${c?.after?.resilience}%`);
  console.log(`    new key player ${s?.after?.top?.label ?? '—'} (surfaced: ${s?.after?.top?.surfaced})`);
  console.log(`    narrative      ${s?.summary?.narrative}`);
  console.log(`\n  Alias pairs planted (resolve to one entity each):`);
  for (const cell of CELLS) console.log(`    ${cell.tag}: ${cell.aliases.label}`);

  if (failures.length) {
    console.log(`\n${pass} passed, ${failures.length} FAILED`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('');
    process.exit(1);
  }
  console.log(`\nAll ${pass} checks passed. The innovation dataset is live.`);
  console.log('Next: open the Fragmentation Simulator in the UI and click the kingpin.\n');
}

main().catch((err) => { console.error('\nseed-innovation crashed:', err); process.exit(1); });