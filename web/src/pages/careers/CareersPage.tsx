import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Award, Briefcase, CalendarClock, CheckCircle2, ChevronRight, Clock, FileText, LogOut, MapPin, Search, Send, Upload, UserCheck, X, AlertCircle } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Checkbox, ErrorBanner, Field, Input, Spinner, Textarea } from '../../components/ui';
import { LegalLinks } from '../../components/LegalLinks';
import { useAuth } from '../../auth/AuthProvider';
import { api, ApiError } from '../../lib/api';
import { titleCase } from '../../lib/format';
import type { DocumentType } from '../../lib/recruitment';
import { useLegalHref } from '../../components/LegalLinks';

interface PublicVacancy {
  id: number;
  title: string;
  description: string | null;
  requirements: string | null;
  employment_type: string;
  branch: { name: string; address: string | null };
  required_documents: DocumentType[];
}

interface CareersResponse {
  business: { name: string; code: string };
  document_types: DocumentType[];
  data: PublicVacancy[];
}

export function PublicLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-full bg-[#f4f6f1]">
      <a href="#main-content" className="sr-only z-50 rounded bg-white px-4 py-2 text-slate-900 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/brand/minimart-logo.svg" alt="" className="size-9 shrink-0 rounded-xl bg-white p-0.5 ring-1 ring-slate-200" />
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-bold leading-tight text-slate-900">{title}</p>
              <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-brand-700">Careers</p>
            </div>
          </div>
          <CareersHeaderActions />
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {subtitle && <p className="mb-6 text-sm text-slate-600">{subtitle}</p>}
        <main id="main-content">{children}</main>
        <footer className="mt-12 border-t border-slate-200 pt-5 text-slate-500">
          <p className="mb-3 text-center text-[11px]">(c) {new Date().getFullYear()} Unified SmartPOS</p>
          <LegalLinks />
        </footer>
      </div>
    </div>
  );
}

const pill = 'inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-brand-50 hover:text-brand-800 hover:ring-brand-300';

/** Signed-out visitors go back to sign in; someone still signed in (e.g. the owner checking the careers page) gets their dashboard or can sign out. */
function CareersHeaderActions() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  if (!user) {
    return <Link to="/login" className={`${pill} pl-3`}><ArrowLeft className="size-4" /> <span className="hidden sm:inline">Back to sign in</span><span className="sm:hidden">Sign in</span></Link>;
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Link to="/" className={`${pill} pl-3`}><ArrowLeft className="size-4" /> <span className="hidden sm:inline">Back to dashboard</span><span className="sm:hidden">Dashboard</span></Link>
      <button type="button" disabled={leaving} className={`${pill} disabled:opacity-60`} title={`Signed in as ${user.name}`}
        onClick={async () => { setLeaving(true); try { await logout(); navigate('/login', { replace: true }); } finally { setLeaving(false); } }}>
        <LogOut className="size-4" /> <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
}

/** `/careers` without a business: ask for the business code (shared by the store), then show its openings. */
export function CareersIndexPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  return (
    <PublicLayout title="Job openings">
      <form
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/careers/${encodeURIComponent(code.trim().toLowerCase())}`);
        }}
      >
        <p className="text-sm text-slate-600">Enter the business code of the store you want to work for. You can find it on the store's job post, or ask the store.</p>
        <Field label="Business code">{(id) => <Input id={id} autoCapitalize="none" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. aling-nena-mini-mart" autoFocus />}</Field>
        <Button type="submit" disabled={!code.trim()}>See job openings</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already applied? <Link to="/applications/status" className="font-medium text-teal-700 hover:underline">Check your application</Link>
        {' · '}
        <Link to="/login" className="font-medium text-teal-700 hover:underline">Staff sign in</Link>
      </p>
    </PublicLayout>
  );
}

const HIRING_STEPS = [
  { icon: Send, label: 'Apply online', text: 'Fill in the form and upload your documents.' },
  { icon: UserCheck, label: 'HR review', text: 'HR checks your application.' },
  { icon: CalendarClock, label: 'Interviews', text: 'Meet HR, then the branch manager.' },
  { icon: Award, label: 'Job offer', text: 'The owner approves and you get an offer.' },
];

/** Public job listings of one business, with the online application form (step 1 of the hiring process). */
export function CareersPage() {
  const { code = '' } = useParams();
  const careers = useQuery({ queryKey: ['careers', code], queryFn: () => api<CareersResponse>(`/careers/${encodeURIComponent(code)}/vacancies`), retry: false });
  const [applying, setApplying] = useState<PublicVacancy | null>(null);

  if (careers.isPending) return <Spinner />;
  if (careers.error) {
    return (
      <PublicLayout title="Careers">
        <ErrorBanner error={careers.error instanceof ApiError && careers.error.status === 404 ? new Error('This business was not found. Check the link you were given.') : careers.error} />
      </PublicLayout>
    );
  }
  const { business, data: vacancies, document_types } = careers.data;

  if (applying) {
    return (
      <PublicLayout title={business.name}>
        <ApplyForm business={business} vacancy={applying} documentTypes={document_types} onCancel={() => { setApplying(null); window.scrollTo({ top: 0 }); }} />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={business.name}>
      {/* Hero */}
      <section className="sp-rise relative isolate overflow-hidden rounded-[28px] bg-[#062a1d] p-6 text-white shadow-[0_30px_60px_-35px_rgba(6,42,29,.8)] sm:p-9">
        <span aria-hidden className="absolute -left-20 -top-28 -z-10 size-80 rounded-full bg-emerald-500/35 blur-[90px]" />
        <span aria-hidden className="absolute -bottom-32 right-0 -z-10 size-80 rounded-full bg-sun-400/25 blur-[100px]" />
        <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/15">
          <span className="size-1.5 rounded-full bg-emerald-400" /> {vacancies.length} open {vacancies.length === 1 ? 'position' : 'positions'}
        </p>
        <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          Work with <span className="text-sun-300">{business.name}</span>
        </h1>
        <p className="mt-3 max-w-xl text-sm text-emerald-50/80 sm:text-base">Apply online in a few minutes. We email you a private link so you can follow your application at every step.</p>

        <ol className="mt-7 grid gap-2.5 sm:grid-cols-4">
          {HIRING_STEPS.map((step, i) => (
            <li key={step.label} className="flex gap-3 rounded-2xl bg-white/[.07] p-3.5 ring-1 ring-white/10 sm:flex-col">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sun-300 to-sun-500 text-brand-900"><step.icon className="size-4" /></span>
              <span>
                <span className="block text-[11px] font-bold uppercase tracking-[.14em] text-sun-300">Step {i + 1}</span>
                <span className="block text-sm font-semibold">{step.label}</span>
                <span className="block text-xs text-emerald-50/70">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Openings */}
      <div className="mt-9 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">Open positions</h2>
          <p className="text-sm text-slate-500">Pick a job and press Apply.</p>
        </div>
      </div>

      {vacancies.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Briefcase className="size-7" /></span>
          <p className="mt-4 font-display text-lg font-bold text-slate-900">No open positions right now</p>
          <p className="mt-1 text-sm text-slate-500">Please check back later.</p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-4">
          {vacancies.map((v, i) => (
            <li key={v.id} style={{ animationDelay: `${i * 60}ms` }}
              className="sp-rise group rounded-3xl bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,.45)] ring-1 ring-slate-900/[.06] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-28px_rgba(15,23,42,.5)] hover:ring-brand-300 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-md shadow-brand-900/20"><Briefcase className="size-6" /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-xl font-bold text-slate-900">{v.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-100"><MapPin className="size-3.5" />{v.branch.name}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 ring-1 ring-sky-100"><Clock className="size-3.5" />{titleCase(v.employment_type)}</span>
                  </div>
                  {v.branch.address && <p className="mt-2 text-xs text-slate-500">{v.branch.address}</p>}
                </div>
                <Button onClick={() => { setApplying(v); window.scrollTo({ top: 0 }); }} className="w-full sm:w-auto" icon={<Send className="size-4" />}>Apply now</Button>
              </div>

              {(v.description || v.requirements) && (
                <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
                  {v.description && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">About the job</p>
                      <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-slate-700">{v.description}</p>
                    </div>
                  )}
                  {v.requirements && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Qualifications</p>
                      <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-slate-700">{v.requirements}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-3.5 py-2.5">
                <span className="text-xs font-semibold text-slate-500">Bring:</span>
                {v.required_documents.length
                  ? v.required_documents.map((d) => <span key={d.type} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"><FileText className="size-3.5 text-brand-600" />{d.label}</span>)
                  : <span className="text-xs text-slate-500">No documents needed</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Link to="/applications/status" className="mt-6 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-900/[.06] transition hover:ring-brand-300">
        <span className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-amber-100 text-amber-700"><Search className="size-5" /></span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">Already applied?</span>
            <span className="block text-xs text-slate-500">Check your stage, interview schedule and offer.</span>
          </span>
        </span>
        <ChevronRight className="size-5 text-slate-400" />
      </Link>
    </PublicLayout>
  );
}

function ApplyForm({ business, vacancy, documentTypes, onCancel }: { business: { code: string }; vacancy: PublicVacancy; documentTypes: DocumentType[]; onCancel: () => void }) {
  const legalHref = useLegalHref();
  const navigate = useNavigate();
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', address: '', birth_date: '', work_experience: '', availability: '', cover_letter: '' });
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [extraType, setExtraType] = useState('other');
  const [extraFile, setExtraFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const err = (f: string) => (error instanceof ApiError ? error.field(f) : undefined);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = new FormData();
    Object.entries(form).forEach(([k, v]) => v && body.append(k, v));
    let i = 0;
    for (const doc of vacancy.required_documents) {
      const file = files[doc.type];
      if (file) {
        body.append(`documents[${i}][type]`, doc.type);
        body.append(`documents[${i}][file]`, file);
        i++;
      }
    }
    if (extraFile) {
      body.append(`documents[${i}][type]`, extraType);
      body.append(`documents[${i}][file]`, extraFile);
    }
    if (consent) body.append('privacy_consent', '1');
    try {
      const result = await api<{ reference: string; status_token: string }>(`/careers/${encodeURIComponent(business.code)}/vacancies/${vacancy.id}/apply`, { method: 'POST', body });
      navigate(`/applications/status?ref=${encodeURIComponent(result.reference)}&token=${encodeURIComponent(result.status_token)}&new=1`);
    } catch (ex) {
      setError(ex);
    } finally {
      setBusy(false);
    }
  }

  const fileError = error instanceof ApiError ? Object.entries(error.errors).find(([k]) => k.startsWith('documents'))?.[1]?.[0] : undefined;

  return (
    <form onSubmit={submit} className="sp-rise overflow-hidden rounded-[28px] bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,.5)] ring-1 ring-slate-900/[.06]" noValidate>
      <div className="relative isolate overflow-hidden bg-[#062a1d] p-6 text-white sm:p-8">
        <span aria-hidden className="absolute -right-16 -top-24 -z-10 size-72 rounded-full bg-sun-400/25 blur-[90px]" />
        <button type="button" onClick={onCancel} className="inline-flex h-9 items-center gap-2 rounded-full bg-white/10 pl-3 pr-4 text-sm font-semibold ring-1 ring-white/20 transition hover:bg-white/20">
          <ArrowLeft className="size-4" /> All positions
        </button>
        <p className="mt-6 text-[11px] font-bold uppercase tracking-[.18em] text-sun-300">Application form</p>
        <h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Apply for {vacancy.title}</h2>
        <p className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15"><MapPin className="size-3.5" />{vacancy.branch.name}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15"><Clock className="size-3.5" />{titleCase(vacancy.employment_type)}</span>
        </p>
      </div>

      <div className="space-y-8 p-6 sm:p-8">
        {error instanceof ApiError && Object.keys(error.errors).length === 0 && <ErrorBanner error={error} />}

        <FormSection n={1} title="About you" text="We use these to contact you about this job.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={err('first_name')}>{(id) => <Input id={id} value={form.first_name} onChange={set('first_name')} autoComplete="given-name" />}</Field>
            <Field label="Last name" error={err('last_name')}>{(id) => <Input id={id} value={form.last_name} onChange={set('last_name')} autoComplete="family-name" />}</Field>
            <Field label="Email" error={err('email')} hint="We send your application link here.">{(id) => <Input id={id} type="email" value={form.email} onChange={set('email')} autoComplete="email" />}</Field>
            <Field label="Mobile number" error={err('phone')}>{(id) => <Input id={id} inputMode="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="09XX XXX XXXX" />}</Field>
            <Field label="Address" error={err('address')} className="sm:col-span-2">{(id) => <Input id={id} value={form.address} onChange={set('address')} autoComplete="street-address" />}</Field>
            <Field label="Birth date" error={err('birth_date')}>{(id) => <Input id={id} type="date" value={form.birth_date} onChange={set('birth_date')} />}</Field>
            <Field label="Availability" error={err('availability')} hint="e.g. Can start in 2 weeks, weekends OK">{(id) => <Input id={id} value={form.availability} onChange={set('availability')} />}</Field>
          </div>
        </FormSection>

        <FormSection n={2} title="Your experience" text="Short answers are fine.">
          <div className="grid gap-4">
            <Field label="Work experience" error={err('work_experience')}>{(id) => <Textarea id={id} rows={3} value={form.work_experience} onChange={set('work_experience')} placeholder="e.g. 1 year as a cashier at a grocery store" />}</Field>
            <Field label="Why do you want this job? (optional)" error={err('cover_letter')}>{(id) => <Textarea id={id} rows={3} value={form.cover_letter} onChange={set('cover_letter')} />}</Field>
          </div>
        </FormSection>

        <FormSection n={3} title="Documents" text="PDF, JPG or PNG, up to 5 MB each.">
          <div className="grid gap-3 sm:grid-cols-2">
            {vacancy.required_documents.map((doc) => (
              <FilePick key={doc.type} label={doc.label} required file={files[doc.type] ?? null} onPick={(file) => setFiles((f) => ({ ...f, [doc.type]: file }))} />
            ))}
          </div>
          <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-[13rem_1fr] sm:items-end">
            <Field label="Other document (optional)">
              {(id) => (
                <select id={id} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm" value={extraType} onChange={(e) => setExtraType(e.target.value)}>
                  {documentTypes.map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
                </select>
              )}
            </Field>
            <FilePick label="File" file={extraFile} onPick={setExtraFile} compact />
          </div>
          {fileError && <p className="mt-2 text-xs text-red-600">{fileError}</p>}
        </FormSection>

        <div className="rounded-2xl bg-emerald-50/60 p-4 ring-1 ring-emerald-100">
          <Checkbox label="I agree that this business may process my personal data to evaluate my application." checked={consent} onChange={setConsent} />
          <p className="ml-7 mt-1 text-xs leading-5 text-slate-500">Read the <Link to={legalHref('privacy')} className="font-semibold text-brand-700 underline underline-offset-2">privacy notice</Link> and <Link to={legalHref('terms')} className="font-semibold text-brand-700 underline underline-offset-2">terms</Link> before submitting. The business named above handles this application.</p>
          {err('privacy_consent') && <p className="mt-1 text-xs text-red-600">{err('privacy_consent')}</p>}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-6 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>Back</Button>
          <Button type="submit" size="lg" loading={busy} disabled={!consent} icon={<Send className="size-4" />}>Submit application</Button>
        </div>
      </div>
    </form>
  );
}

function FormSection({ n, title, text, children }: { n: number; title: string; text: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-sm font-extrabold text-brand-700 ring-1 ring-brand-100">{n}</span>
        <div>
          <h3 className="font-display text-lg font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{text}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_TYPES = /\.(pdf|jpe?g|png)$/i;
const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** A file box that shows the chosen file (name and size), checks type and size right away, and can be cleared or changed. */
function FilePick({ label, required, file, onPick, compact }: { label: string; required?: boolean; file: File | null; onPick: (file: File | null) => void; compact?: boolean }) {
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(picked: File | null) {
    if (inputRef.current) inputRef.current.value = ''; // lets the same file be picked again after removing it
    if (!picked) return;
    if (!FILE_TYPES.test(picked.name)) { setProblem('Use a PDF, JPG or PNG file.'); onPick(null); return; }
    if (picked.size > MAX_FILE_BYTES) { setProblem(`This file is ${fileSize(picked.size)}. The limit is 5 MB.`); onPick(null); return; }
    setProblem(null);
    onPick(picked);
  }

  const tone = problem ? 'border-rose-300 bg-rose-50/60' : file ? 'border-solid border-emerald-300 bg-emerald-50/60' : 'border-dashed border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40';
  return (
    <div>
      <div className={`group relative flex items-center gap-3 rounded-2xl border-2 px-4 transition focus-within:ring-2 focus-within:ring-brand-400 focus-within:ring-offset-1 ${compact ? 'min-h-10 py-1.5' : 'py-3.5'} ${tone}`}>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
          <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only" aria-label={file ? `Change ${label}` : label} onChange={(e) => choose(e.target.files?.[0] ?? null)} />
          {!compact && (
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${problem ? 'bg-rose-100 text-rose-600' : file ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500 group-hover:text-brand-700'}`}>
              {problem ? <AlertCircle className="size-5" /> : file ? <CheckCircle2 className="size-5" /> : <Upload className="size-5" />}
            </span>
          )}
          <span className="min-w-0 flex-1">
            {!compact && (
              <span className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-slate-800">
                {label}
                {file
                  ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Attached</span>
                  : required && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Required</span>}
              </span>
            )}
            <span className={`block truncate text-xs ${file ? 'font-medium text-emerald-800' : 'text-slate-500'}`} title={file?.name}>
              {file ? `${file.name} · ${fileSize(file.size)}` : 'Tap to choose a file'}
            </span>
            {file && !compact && <span className="block text-[11px] text-slate-500">Tap to change</span>}
          </span>
        </label>
        {file && (
          <button type="button" onClick={() => { setProblem(null); onPick(null); }} aria-label={`Remove ${label}`}
            className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-white hover:text-rose-600">
            <X className="size-4" />
          </button>
        )}
      </div>
      {problem && <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">{problem}</p>}
    </div>
  );
}
