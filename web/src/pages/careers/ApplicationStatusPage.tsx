import { Briefcase, CalendarClock, CheckCircle2, ChevronDown, KeyRound, Mail, MailCheck, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
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

  // "Email me my link": the reply is the same whether or not the email has applied.
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [linkError, setLinkError] = useState<unknown>(null);
  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setLinkError(null);
    try {
      await api('/careers/applications/resend-link', { method: 'POST', body: { email: email.trim() } });
      setSent(true);
    } catch (ex) {
      setLinkError(ex);
    } finally {
      setSending(false);
    }
  }

  function lookUp(e: FormEvent) {
    e.preventDefault();
    setParams({ ref: reference, token });
    void call('status');
  }

  if (!data) {
    return (
      <PublicLayout title="Your job application">
        <div className="space-y-4">
          {/* Main way in: get the link by email. */}
          <section className="overflow-hidden rounded-3xl bg-white shadow-[0_20px_50px_-30px_rgba(15,23,42,.45)] ring-1 ring-slate-900/[.06]">
            <div className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-[#062a1d] p-6 text-white">
              <span aria-hidden className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-sun-400/25 blur-3xl" />
              <span className="relative grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-sun-300 to-sun-500 text-brand-900 shadow-lg"><Briefcase className="size-6" /></span>
              <h2 className="relative mt-4 font-display text-2xl font-extrabold tracking-tight">Check your application</h2>
              <p className="relative mt-1 text-sm text-brand-100/80">See your stage, interview schedule and job offer. HR, the branch manager and the owner review every application.</p>
            </div>
            {sent ? (
              <div className="sp-rise p-6 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 ring-8 ring-emerald-50"><MailCheck className="size-7" /></span>
                <p className="mt-4 font-display text-lg font-bold text-slate-900">Check your email</p>
                <p className="mt-1 text-sm text-slate-600">If <strong>{email.trim()}</strong> has applied, we sent it a link to each application. Open it on this device. Check Spam too.</p>
                <button type="button" onClick={() => setSent(false)} className="mt-4 text-sm font-semibold text-brand-700 hover:underline">Use another email</button>
              </div>
            ) : (
              <form onSubmit={sendLink} className="space-y-4 p-6">
                <ErrorBanner error={linkError} />
                <Field label="The email you applied with">
                  {(id) => (
                    <div className="relative">
                      <Mail aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <Input id={id} type="email" required autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" />
                    </div>
                  )}
                </Field>
                <Button type="submit" loading={sending} disabled={!email.trim()} className="w-full" icon={<Send className="size-4" />}>Email me my application link</Button>
                <p className="text-center text-xs text-slate-500">For your privacy, the link goes to your email; the page never shows applications to someone who only knows the email.</p>
                <p className="text-center text-sm text-slate-600">Haven't applied yet? <Link to="/careers/aling-nena-mini-mart" className="font-semibold text-brand-700 hover:underline">See job openings</Link></p>
              </form>
            )}
          </section>

          {/* Second way in: the reference and key from the confirmation email. */}
          <details open={!!(reference || token) || undefined} className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[.06]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-700">
              <span className="flex items-center gap-2"><KeyRound className="size-4 text-brand-600" /> I have my reference and access key</span>
              <ChevronDown className="size-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <form onSubmit={lookUp} className="mt-4 space-y-4">
              <ErrorBanner error={error} />
              <Field label="Application reference" hint="Starts with APP-, e.g. APP-7K2QZ9XB">{(id) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="APP-XXXXXXXX" />}</Field>
              <Field label="Access key" hint="The long code after token= in your email link (not your email address).">{(id) => <Input id={id} value={token} onChange={(e) => setToken(e.target.value.trim())} />}</Field>
              <Button type="submit" variant="secondary" loading={busy} disabled={!reference || !token}>View application</Button>
            </form>
          </details>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={`${data.business} — ${data.position}`}>
      <div className="space-y-4">
        {justApplied && !data.closed && data.step === 1 && (
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

        {data.can_withdraw && <WithdrawBox busy={busy} onWithdraw={(reason) => call('withdraw', { reason })} />}
      </div>
    </PublicLayout>
  );
}

/** Withdraw with an optional reason, asked on the page (no browser pop-up, which phone app views may block). */
function WithdrawBox({ busy, onWithdraw }: { busy: boolean; onWithdraw: (reason: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return <p className="text-center text-sm"><button type="button" className="text-slate-500 underline hover:text-red-700" onClick={() => setOpen(true)}>Withdraw my application</button></p>;
  }
  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 text-sm">
      <p className="font-semibold text-rose-900">Withdraw your application?</p>
      <p className="mt-1 text-rose-900/80">This closes it for good. You can apply again later.</p>
      <Textarea className="mt-3" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="You can tell us why (optional)" />
      <div className="mt-3 flex gap-2">
        <Button variant="danger" loading={busy} onClick={async () => { if (await onWithdraw(reason.trim())) setOpen(false); }}>Withdraw application</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Keep it</Button>
      </div>
    </section>
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
