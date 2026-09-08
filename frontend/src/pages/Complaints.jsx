/**
 * The complaint register — Scene 1's landing point.
 *
 * A dense table rather than a card grid. This is the view an investigator scans
 * for a reference number or a pattern, and cards would fit a fifth as many rows
 * on screen while adding nothing: every field here is a short scalar, which is
 * exactly what a table is for.
 *
 * Filtering is server-side (`/api/complaints` takes state, category, status,
 * cluster and a search term) so the client never holds more than a page. The
 * one thing done here is DEBOUNCING the search box — typing "Rathore" would
 * otherwise fire seven requests, and the useApi hook aborts the stale ones but
 * they still cost the server.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileSearch, Plus, Search, X } from 'lucide-react';

import { complaints as complaintsApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useApi } from '@/hooks/useApi';
import { Empty, Failed, Loading, Panel } from '@/components/ui/Bits';
import { ago, inr, num, scamLabel } from '@/utils/format';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  'UPI_FRAUD', 'INVESTMENT_SCAM', 'DIGITAL_ARREST', 'JOB_FRAUD', 'LOAN_APP',
  'CRYPTO_FRAUD', 'SEXTORTION', 'PHISHING', 'MATRIMONIAL', 'OTP_FRAUD', 'OTHER',
];
const STATUSES = ['NEW', 'TRIAGED', 'LINKED', 'UNDER_INVESTIGATION', 'CLOSED'];
const PAGE_SIZE = 40;

const STATUS_TONE = {
  NEW: 'text-bluehi',
  TRIAGED: 'text-dim',
  LINKED: 'text-purple',
  UNDER_INVESTIGATION: 'text-amber',
  CLOSED: 'text-faint',
};

const EMPTY_FORM = {
  victim_name: '',
  victim_phone: '',
  victim_email: '',
  narrative: '',
  scam_category: 'OTHER',
  amount_inr: '0',
  state: '',
  district: '',
};

/** A compact native select, styled to match the chips rather than the OS. */
function Select({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-[26px] rounded-[3px] border border-hair bg-panel px-1.5 text-[11.5px] outline-none transition-colors',
        'focus:border-blue',
        value ? 'text-txt' : 'text-faint'
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>{scamLabel(o)}</option>
      ))}
    </select>
  );
}

export default function Complaints() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [newComplaintOpen, setNewComplaintOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // 280ms: long enough to swallow a burst of keystrokes, short enough that it
  // still feels like the list is reacting to typing.
  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(query.trim()); setPage(0); }, 280);
    return () => clearTimeout(timer);
  }, [query]);

  const params = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      q: debounced || undefined,
      category: category || undefined,
      status: status || undefined,
    }),
    [page, debounced, category, status]
  );

  const { data, error, loading, refetch } = useApi(
    ({ signal }) => complaintsApi.list({ ...params }, { signal }),
    [params]
  );

  const hasFilters = Boolean(debounced || category || status);
  const clearAll = () => { setQuery(''); setCategory(''); setStatus(''); setPage(0); };

  const from = page * PAGE_SIZE;
  const shown = data?.complaints?.length ?? 0;

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  async function submitComplaint(event) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await complaintsApi.create({
        ...form,
        amount_inr: Number(form.amount_inr || 0),
        victim_phone: form.victim_phone || null,
        victim_email: form.victim_email || null,
        state: form.state || null,
        district: form.district || null,
      });
      setForm(EMPTY_FORM);
      setNewComplaintOpen(false);
      setPage(0);
      refetch();
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Panel
        title="Complaint register"
        subtitle={data ? `${num(data.total)} on record` : undefined}
        flush
        className="min-h-0 flex-1"
        right={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { setSubmitError(null); setNewComplaintOpen(true); }}
              className="flex h-[26px] items-center gap-1.5 rounded-[3px] bg-blue px-2.5 text-[11.5px] font-medium text-white transition-colors hover:bg-bluehi"
            >
              <Plus className="size-3.5" strokeWidth={2} />
              New complaint
            </button>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-faint" strokeWidth={1.75} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Reference, victim, narrative…"
                className="h-[26px] w-56 rounded-[3px] border border-hair bg-panel pr-2 pl-[26px] text-[11.5px] text-txt outline-none transition-colors placeholder:text-faint focus:border-blue"
              />
            </div>
            <Select value={category} onChange={(v) => { setCategory(v); setPage(0); }} options={CATEGORIES} placeholder="All categories" />
            <Select value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={STATUSES} placeholder="All statuses" />
            {hasFilters && (
              <button
                type="button"
                onClick={clearAll}
                title="Clear filters"
                className="flex size-[26px] items-center justify-center rounded-[3px] border border-hair text-faint transition-colors hover:border-faint hover:text-txt"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            )}
          </div>
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            {loading && !data ? (
              <Loading label="Loading complaints" />
            ) : error ? (
              <Failed error={error} onRetry={refetch} />
            ) : !shown ? (
              <Empty
                icon={FileSearch}
                title="No complaints match"
                hint={hasFilters ? 'Try widening the filters.' : 'Nothing has been filed yet.'}
                action={
                  hasFilters ? (
                    <button
                      type="button"
                      onClick={clearAll}
                      className="mt-1 rounded-[2px] border border-hair px-2 py-1 text-[11px] text-dim transition-colors hover:border-faint hover:text-txt"
                    >
                      Clear filters
                    </button>
                  ) : null
                }
              />
            ) : (
              <table className="w-full text-left">
                {/* Sticky header: the register is scrolled, and a column you
                    cannot name is a column you cannot read. */}
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="border-b border-hair">
                    {['Reference', 'Victim', 'Category', 'Amount', 'Location', 'Entities', 'Status', 'Filed'].map((h) => (
                      <th key={h} className="lbl px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.complaints.map((c) => (
                    <tr key={c.id} className="row-hover border-b border-hair last:border-b-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link to={`/complaints/${c.id}`} className="mn text-[11.5px] text-bluehi hover:underline">
                          {c.complaint_ref}
                        </Link>
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-[12px] text-txt">{c.victim_name}</td>
                      <td className="px-3 py-2 text-[11.5px] whitespace-nowrap text-dim">{scamLabel(c.scam_category)}</td>
                      <td className="mn px-3 py-2 text-[11.5px] whitespace-nowrap text-txt">{inr(c.amount_inr, { compact: true })}</td>
                      <td className="px-3 py-2 text-[11.5px] whitespace-nowrap text-dim">
                        {c.state ?? '—'}
                        {c.district && <span className="text-faint"> · {c.district}</span>}
                      </td>
                      <td className="mn px-3 py-2 text-[11.5px] text-dim">{c.entity_count}</td>
                      <td className={cn('px-3 py-2 text-[11px] whitespace-nowrap', STATUS_TONE[c.status] ?? 'text-dim')}>
                        {scamLabel(c.status)}
                      </td>
                      <td className="px-3 py-2 text-[11px] whitespace-nowrap text-faint">{ago(c.filed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ---- pagination ---- */}
          {data && shown > 0 && (
            <div className="flex shrink-0 items-center justify-between border-t border-hair px-3 py-1.5">
              <span className="mn text-[11px] text-faint">
                {num(from + 1)}–{num(from + shown)} of {num(data.total)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="flex size-[24px] items-center justify-center rounded-[3px] border border-hair text-dim transition-colors hover:border-faint hover:text-txt disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="size-3.5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  disabled={!data.has_more}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex size-[24px] items-center justify-center rounded-[3px] border border-hair text-dim transition-colors hover:border-faint hover:text-txt disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            </div>
          )}
        </div>
      </Panel>

      {newComplaintOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <form onSubmit={submitComplaint} className="flex max-h-[calc(100dvh-32px)] w-full max-w-2xl flex-col overflow-auto rounded-[4px] border border-hair bg-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-hair px-4 py-3">
              <div>
                <h2 className="text-[14px] font-semibold text-txt">New complaint</h2>
                <p className="mt-0.5 text-[11px] text-faint">Submit a narrative for entity extraction and graph linking.</p>
              </div>
              <button type="button" onClick={() => setNewComplaintOpen(false)} title="Close" className="flex size-7 items-center justify-center rounded-[3px] text-faint hover:bg-raise hover:text-txt">
                <X className="size-4" />
              </button>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11px] text-dim">Victim name *<input required value={form.victim_name} onChange={(e) => updateForm('victim_name', e.target.value)} className="h-8 rounded-[3px] border border-hair bg-deep px-2 text-[12px] text-txt outline-none focus:border-blue" /></label>
              <label className="flex flex-col gap-1 text-[11px] text-dim">Victim phone<input value={form.victim_phone} onChange={(e) => updateForm('victim_phone', e.target.value)} className="h-8 rounded-[3px] border border-hair bg-deep px-2 text-[12px] text-txt outline-none focus:border-blue" /></label>
              <label className="flex flex-col gap-1 text-[11px] text-dim">Victim email<input type="email" value={form.victim_email} onChange={(e) => updateForm('victim_email', e.target.value)} className="h-8 rounded-[3px] border border-hair bg-deep px-2 text-[12px] text-txt outline-none focus:border-blue" /></label>
              <label className="flex flex-col gap-1 text-[11px] text-dim">Amount (INR)<input type="number" min="0" value={form.amount_inr} onChange={(e) => updateForm('amount_inr', e.target.value)} className="h-8 rounded-[3px] border border-hair bg-deep px-2 text-[12px] text-txt outline-none focus:border-blue" /></label>
              <label className="flex flex-col gap-1 text-[11px] text-dim">Scam category<select value={form.scam_category} onChange={(e) => updateForm('scam_category', e.target.value)} className="h-8 rounded-[3px] border border-hair bg-deep px-2 text-[12px] text-txt outline-none focus:border-blue">{CATEGORIES.map((option) => <option key={option} value={option}>{scamLabel(option)}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-[11px] text-dim">State<input value={form.state} onChange={(e) => updateForm('state', e.target.value)} className="h-8 rounded-[3px] border border-hair bg-deep px-2 text-[12px] text-txt outline-none focus:border-blue" /></label>
              <label className="flex flex-col gap-1 text-[11px] text-dim sm:col-span-2">District<input value={form.district} onChange={(e) => updateForm('district', e.target.value)} className="h-8 rounded-[3px] border border-hair bg-deep px-2 text-[12px] text-txt outline-none focus:border-blue" /></label>
              <label className="flex flex-col gap-1 text-[11px] text-dim sm:col-span-2">Complaint narrative *<textarea required minLength={10} rows={6} value={form.narrative} onChange={(e) => updateForm('narrative', e.target.value)} placeholder="Describe what happened and include identifiers such as phone numbers, UPI IDs, accounts, wallets, or emails." className="rounded-[3px] border border-hair bg-deep px-2 py-1.5 text-[12px] text-txt outline-none focus:border-blue" /></label>
            </div>

            {submitError && <p className="mx-4 mb-3 rounded-[3px] border border-danger/30 bg-danger/[0.08] px-3 py-2 text-[11.5px] text-danger">{submitError}</p>}
            <div className="flex justify-end gap-2 border-t border-hair px-4 py-3">
              <button type="button" onClick={() => setNewComplaintOpen(false)} className="h-8 rounded-[3px] border border-hair px-3 text-[11.5px] text-dim hover:border-faint hover:text-txt">Cancel</button>
              <button type="submit" disabled={submitting} className="h-8 rounded-[3px] bg-blue px-3 text-[11.5px] font-medium text-white hover:bg-bluehi disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit complaint'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
