import { useQuery } from '@tanstack/react-query';
import { Briefcase, MapPin } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Checkbox, ErrorBanner, Field, Input, Spinner, Textarea } from '../../components/ui';
import { LegalLinks } from '../../components/LegalLinks';
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
    <div className="min-h-full bg-slate-100 px-4 py-10">
      <a href="#main-content" className="sr-only z-50 rounded bg-white px-4 py-2 text-slate-900 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-teal-700 text-sm font-bold text-white">SP</span>
          <span className="text-lg font-semibold text-slate-900">{title}</span>
        </div>
        {subtitle && <p className="-mt-4 mb-6 text-sm text-slate-600">{subtitle}</p>}
        <main id="main-content">{children}</main>
        <footer className="mt-8 border-t border-slate-200 pt-4 text-slate-500">
          <p className="mb-2 text-center text-[11px]">(c) {new Date().getFullYear()} Unified SmartPOS</p>
          <LegalLinks />
        </footer>
      </div>
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

  return (
    <PublicLayout title={`Careers at ${business.name}`} subtitle="Apply online, then follow your application from the link we email you.">
      {applying ? (
        <ApplyForm business={business} vacancy={applying} documentTypes={document_types} onCancel={() => setApplying(null)} />
      ) : vacancies.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No open positions right now. Please check back later.</div>
      ) : (
        <ul className="space-y-3">
          {vacancies.map((v) => (
            <li key={v.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{v.title}</h2>
                  <p className="mt-1 flex flex-wrap gap-3 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-1"><MapPin className="size-4" />{v.branch.name}</span>
                    <span className="inline-flex items-center gap-1"><Briefcase className="size-4" />{titleCase(v.employment_type)}</span>
                  </p>
                </div>
                <Button onClick={() => setApplying(v)}>Apply</Button>
              </div>
              {v.description && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{v.description}</p>}
              {v.requirements && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Qualifications</p>
                  <p className="whitespace-pre-line text-sm text-slate-700">{v.requirements}</p>
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">Documents to upload: {v.required_documents.map((d) => d.label).join(', ') || 'none'}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-center text-sm text-slate-500">
        Already applied? <Link to="/applications/status" className="font-medium text-teal-700 hover:underline">Check your application</Link>
      </p>
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
    <form onSubmit={submit} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Apply for {vacancy.title}</h2>
        <p className="text-sm text-slate-500">{vacancy.branch.name}</p>
      </div>
      {error instanceof ApiError && Object.keys(error.errors).length === 0 && <ErrorBanner error={error} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={err('first_name')}>{(id) => <Input id={id} value={form.first_name} onChange={set('first_name')} autoComplete="given-name" />}</Field>
        <Field label="Last name" error={err('last_name')}>{(id) => <Input id={id} value={form.last_name} onChange={set('last_name')} autoComplete="family-name" />}</Field>
        <Field label="Email" error={err('email')} hint="We send your application link here.">{(id) => <Input id={id} type="email" value={form.email} onChange={set('email')} autoComplete="email" />}</Field>
        <Field label="Mobile number" error={err('phone')}>{(id) => <Input id={id} inputMode="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />}</Field>
        <Field label="Address" error={err('address')} className="sm:col-span-2">{(id) => <Input id={id} value={form.address} onChange={set('address')} autoComplete="street-address" />}</Field>
        <Field label="Birth date" error={err('birth_date')}>{(id) => <Input id={id} type="date" value={form.birth_date} onChange={set('birth_date')} />}</Field>
        <Field label="Availability" error={err('availability')} hint="e.g. Can start in 2 weeks, weekends OK">{(id) => <Input id={id} value={form.availability} onChange={set('availability')} />}</Field>
        <Field label="Work experience" error={err('work_experience')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={form.work_experience} onChange={set('work_experience')} />}</Field>
        <Field label="Why do you want this job? (optional)" error={err('cover_letter')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={form.cover_letter} onChange={set('cover_letter')} />}</Field>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-700">Documents <span className="font-normal text-slate-500">(PDF, JPG or PNG, up to 5 MB each)</span></p>
        {vacancy.required_documents.map((doc) => (
          <Field key={doc.type} label={`${doc.label} (required)`}>
            {(id) => <Input id={id} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles((f) => ({ ...f, [doc.type]: e.target.files?.[0] ?? null }))} />}
          </Field>
        ))}
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label="Other document (optional)">
            {(id) => (
              <select id={id} className="h-10 w-full rounded-lg border border-slate-300 px-2 text-sm" value={extraType} onChange={(e) => setExtraType(e.target.value)}>
                {documentTypes.map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
              </select>
            )}
          </Field>
          <Field label="File">{(id) => <Input id={id} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setExtraFile(e.target.files?.[0] ?? null)} />}</Field>
        </div>
        {fileError && <p className="text-xs text-red-600">{fileError}</p>}
      </div>

      <div>
        <Checkbox label="I agree that this business may process my personal data to evaluate my application." checked={consent} onChange={setConsent} />
        <p className="ml-7 mt-1 text-xs leading-5 text-slate-500">Read the <Link to={legalHref('privacy')} className="font-semibold text-brand-700 underline underline-offset-2">privacy notice</Link> and <Link to={legalHref('terms')} className="font-semibold text-brand-700 underline underline-offset-2">terms</Link> before submitting. The business named above handles this application.</p>
        {err('privacy_consent') && <p className="mt-1 text-xs text-red-600">{err('privacy_consent')}</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Back</Button>
        <Button type="submit" loading={busy} disabled={!consent}>Submit application</Button>
      </div>
    </form>
  );
}
