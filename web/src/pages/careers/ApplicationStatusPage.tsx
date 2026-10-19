import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { HiringSteps } from '../../components/HiringSteps';
import { Button, ErrorBanner, Field, Input, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { MODE_LABELS, type PublicApplication } from '../../lib/recruitment';
import { PublicLayout } from './CareersPage';
import { useConfirm } from '../../components/Confirm';

/**
 * The applicant's view of their application (reference + secret token from the confirmation email).
 * Shows the stage, interview schedule and offer — never internal notes, scores or reasons.
 */
export function ApplicationStatusPage() {
  const ask = useConfirm();
  const [params, setParams] = useSearchParams();
  const [reference, setReference] = useState(params.get('ref') ?? '');
  const [token, setToken] = useState(params.get('token') ?? '');
  const [data, setData] = useState<PublicApplication | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const justApplied = params.get('new') === '1';

  async function call(path: string, extra: Record<string, unknown> | FormData = {}) {
    setBusy(true);
    setError(null);
    try {
      let body: Record<string, unknown> | FormData;
      if (extra instanceof FormData) {
        extra.append('reference', reference);
        extra.append('token', token);
        body = extra;
      } else {
        body = { reference, token, ...extra };
      }
      const result = await api<{ data: PublicApplication }>(`/careers/applications/${path}`, { method: 'POST', body });
      setData(result.data);
      return true;
    } catch (ex) {
      setError(ex);
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (params.get('ref') && params.get('token')) void call('status');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function lookUp(e: FormEvent) {
    e.preventDefault();
    setParams({ ref: reference, token });
    void call('status');
  }

  if (!data) {
    return (
      <PublicLayout title="Your job application">
        <form onSubmit={lookUp} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Open the link in your confirmation email, or enter the details from it.</p>
          <ErrorBanner error={error} />
          <Field label="Application reference">{(id) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="APP-XXXXXXXX" />}</Field>
          <Field label="Access key (from the email link)">{(id) => <Input id={id} value={token} onChange={(e) => setToken(e.target.value)} />}</Field>
          <Button type="submit" loading={busy} disabled={!reference || !token}>View application</Button>
        </form>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={`${data.business} — ${data.position}`}>
      <div className="space-y-4">
        {justApplied && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" /> Application submitted</p>
            <p className="mt-1">Your reference is <strong>{data.reference}</strong>. We emailed you a link to this page — keep it, or bookmark this page now. It is the only way to see your application.</p>
          </div>
        )}
        <ErrorBanner error={error} />

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs text-slate-500">Reference {data.reference} · {data.name}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{data.status_label}</p>
          <div className="mt-4"><HiringSteps current={data.step} closedLabel={data.closed && data.step === null ? 'This application is closed.' : undefined} /></div>
        </section>

        {data.message && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">We need more from you</p>
            <p className="mt-1 whitespace-pre-line">{data.message}</p>
          </section>
        )}

        {data.interviews.map((i) => <InterviewCard key={i.id} interview={i} busy={busy} onRequest={(reason) => call('reschedule-request', { interview_id: i.id, reason })} />)}

        {data.offer && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="font-semibold text-slate-900">Job offer</p>
            <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-slate-500">Position</dt><dd className="font-medium">{data.offer.position}</dd></div>
              <div><dt className="text-xs text-slate-500">Start date</dt><dd className="font-medium">{formatDate(data.offer.start_date)}</dd></div>
              {data.offer.salary && <div><dt className="text-xs text-slate-500">Salary</dt><dd className="font-medium">{formatMoney(data.offer.salary)}</dd></div>}
            </dl>
            {data.offer.terms && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{data.offer.terms}</p>}
            {data.can_respond_to_offer && (
              <div className="mt-4 flex gap-2">
                <Button loading={busy} onClick={() => void call('offer-response', { accept: true })}>Accept offer</Button>
                <Button variant="secondary" disabled={busy} onClick={async () => { if (await ask({ title: 'Decline this job offer?', message: 'This cannot be undone.', confirmLabel: 'Decline offer' })) void call('offer-response', { accept: false }); }}>Decline</Button>
              </div>
            )}
          </section>
        )}

        <DocumentsCard data={data} busy={busy} onUpload={(form) => call('documents', form)} />

        {data.can_withdraw && (
          <p className="text-center text-sm">
            <button type="button" className="text-slate-500 underline hover:text-red-700" onClick={() => {
              const reason = prompt('Withdraw your application? You can tell us why (optional).');
              if (reason !== null) void call('withdraw', { reason });
            }}>
              Withdraw my application
            </button>
          </p>
        )}
      </div>
    </PublicLayout>
  );
}

function InterviewCard({ interview, busy, onRequest }: { interview: PublicApplication['interviews'][number]; busy: boolean; onRequest: (reason: string) => Promise<boolean> }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sm text-sky-950">
      <p className="flex items-center gap-2 font-semibold"><CalendarClock className="size-4" /> {interview.stage}</p>
      <p className="mt-1">{formatDateTime(interview.scheduled_at)} · {MODE_LABELS[interview.mode] ?? interview.mode}{interview.location ? ` · ${interview.location}` : ''}</p>
      {interview.reschedule_requested ? (
        <p className="mt-2 text-xs">You asked for a new schedule. We will contact you.</p>
      ) : asking ? (
        <div className="mt-3 space-y-2">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why can't you attend, and when are you available?" />
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={!reason} onClick={async () => (await onRequest(reason)) && setAsking(false)}>Send request</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <button type="button" className="mt-2 text-xs font-medium underline" onClick={() => setAsking(true)}>I can't attend — request another schedule</button>
      )}
    </section>
  );
}

function DocumentsCard({ data, busy, onUpload }: { data: PublicApplication; busy: boolean; onUpload: (form: FormData) => Promise<boolean> }) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState('other');
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="font-semibold text-slate-900">Your documents</p>
      <ul className="mt-2 space-y-1 text-sm text-slate-700">
        {data.documents.map((d, i) => <li key={i}>{d.type}: <span className="text-slate-500">{d.name}</span></li>)}
      </ul>
      {data.can_upload && (
        <div className="mt-4 grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <Field label="Type">
            {(id) => (
              <select id={id} className="h-10 w-full rounded-lg border border-slate-300 px-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
                {[['resume', 'Resume / CV'], ['valid_id', 'Valid government ID'], ['nbi_clearance', 'NBI clearance'], ['barangay_clearance', 'Barangay clearance'], ['medical_certificate', 'Medical certificate'], ['birth_certificate', 'Birth certificate (PSA)'], ['diploma', 'Diploma / transcript'], ['other', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
          </Field>
          <Field label="File">{(id) => <Input id={id} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
          <Button loading={busy} disabled={!file} onClick={async () => {
            const form = new FormData();
            form.append('documents[0][type]', type);
            form.append('documents[0][file]', file as File);
            if (await onUpload(form)) setFile(null);
          }}>Upload</Button>
        </div>
      )}
    </section>
  );
}
