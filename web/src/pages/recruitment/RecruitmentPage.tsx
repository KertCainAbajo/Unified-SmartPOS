import { ArrowRight, BadgeCheck, Briefcase, Check, ChevronRight, ClipboardCheck, Clock, Copy, Download, ExternalLink, FileSignature, FileText, Globe, History as HistoryIcon, Inbox, KeyRound, Mail, MessagesSquare, Phone, Plus, Printer, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { HiringSteps } from '../../components/HiringSteps';
import { useToast } from '../../components/Toast';
import { BranchTag } from '../../components/BranchSwitcher';
import { Avatar, Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, Input, LoadingRows, Modal, PageHeader, Pagination, SearchField, Select, Tabs, Textarea, cx } from '../../components/ui';
import { ApiError, downloadFile } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney, titleCase } from '../../lib/format';
import { printDocument } from '../../lib/print';
import { useDebounced, useTenantMutation, useTenantQuery } from '../../lib/hooks';
import {
  DECISION_LABELS,
  DECISIONS,
  MODE_LABELS,
  STATUS_LABELS,
  stepOf,
  type ApplicationStatus,
  type Interview,
  type InterviewStage,
  type JobApplication,
  type Vacancy,
} from '../../lib/recruitment';
import type { Paginated, Role } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { CredentialSlip, toCredentials, type Credentials, type IssuedResponse } from '../admin/TeamPage';
import { NoAccess } from '../NotFoundPage';

const DOCUMENT_TYPES: Record<string, string> = {
  resume: 'Resume / CV',
  valid_id: 'Valid government ID',
  nbi_clearance: 'NBI clearance',
  barangay_clearance: 'Barangay clearance',
  medical_certificate: 'Medical certificate',
  birth_certificate: 'Birth certificate (PSA)',
  diploma: 'Diploma / transcript',
  other: 'Other',
};

const STATUS_TONE: Partial<Record<ApplicationStatus, string>> = {
  hired: 'active',
  approved: 'active',
  offer_accepted: 'active',
  rejected: 'rejected',
  withdrawn: 'cancelled',
  offer_declined: 'cancelled',
  incomplete: 'pending_approval',
};

/**
 * Hiring workflow: HR screening → HR interview → branch manager interview → owner final interview → offer →
 * onboarding → SmartPOS account. The server enforces every stage and permission; this page offers the actions
 * that apply to the current stage and the signed-in member.
 */
export function RecruitmentPage() {
  const { can, tenant } = useTenant();
  const toast = useToast();
  const [tab, setTab] = useState<'applications' | 'vacancies'>('applications');
  if (!can('recruitment.view')) return <NoAccess what="recruitment" />;
  const careersUrl = `${window.location.origin}/careers/${tenant.slug}`;

  return (
    <>
      <PageHeader
        eyebrow="Business"
        title="Recruitment"
        description="Applications move through HR screening, HR interview, branch manager interview and the owner's final interview before an offer and onboarding."
        actions={
          <div className="inline-flex h-9 items-center overflow-hidden rounded-full bg-white text-xs font-medium shadow-sm ring-1 ring-slate-900/5">
            <span className="flex items-center gap-2 pl-3.5 pr-2 text-slate-600"><Globe className="size-3.5 text-brand-600" />Careers page</span>
            <button type="button" title="Copy link" onClick={() => void navigator.clipboard?.writeText(careersUrl).then(() => toast.success('Careers page link copied.'))} className="grid h-full w-9 place-items-center border-l border-slate-100 text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"><Copy className="size-3.5" /></button>
            <a href={careersUrl} target="_blank" rel="noreferrer" title="Open careers page" className="grid h-full w-9 place-items-center border-l border-slate-100 text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"><ExternalLink className="size-3.5" /></a>
          </div>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'applications', label: 'Applications', icon: Inbox }, { value: 'vacancies', label: 'Vacancies', icon: Briefcase }]} />
      <div key={tab} className="auth-fade">{tab === 'applications' ? <ApplicationsTab /> : <VacanciesTab />}</div>
    </>
  );
}

/* =========================================================================== Applications */

/** Pipeline columns; each covers one or more application statuses. */
const PIPELINE: { key: string; label: string; statuses: ApplicationStatus[]; icon: LucideIcon; tone: string }[] = [
  { key: 'new', label: 'New & screening', statuses: ['submitted', 'hr_screening', 'incomplete'], icon: Inbox, tone: 'from-sky-400 to-sky-600' },
  { key: 'interview', label: 'Interviewing', statuses: ['hr_interview', 'manager_interview', 'owner_final_interview'], icon: MessagesSquare, tone: 'from-violet-400 to-violet-600' },
  { key: 'offer', label: 'Offer', statuses: ['approved', 'offer_sent', 'offer_accepted'], icon: FileSignature, tone: 'from-amber-400 to-orange-500' },
  { key: 'onboarding', label: 'Onboarding', statuses: ['onboarding'], icon: ClipboardCheck, tone: 'from-teal-400 to-emerald-600' },
  { key: 'hired', label: 'Hired', statuses: ['hired'], icon: BadgeCheck, tone: 'from-brand-500 to-brand-700' },
];

function usePipelineCount(statuses: ApplicationStatus[], branchId: number | undefined) {
  const q = useTenantQuery<Paginated<JobApplication>>('/applications', { status: statuses.join(','), branch_id: branchId, per_page: 1 });
  return q.data ? q.data.meta?.total ?? q.data.total ?? q.data.data.length : null;
}

const daysAgo = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};

function ApplicationsTab() {
  const { scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useTenantQuery<Paginated<JobApplication>>('/applications', { page, status, q, branch_id: scopeBranchId });
  const counts = [
    usePipelineCount(PIPELINE[0].statuses, scopeBranchId),
    usePipelineCount(PIPELINE[1].statuses, scopeBranchId),
    usePipelineCount(PIPELINE[2].statuses, scopeBranchId),
    usePipelineCount(PIPELINE[3].statuses, scopeBranchId),
    usePipelineCount(PIPELINE[4].statuses, scopeBranchId),
  ];
  const rows = list.data?.data ?? [];
  const filtered = !!q || !!status;

  return (
    <>
      {/* Pipeline */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {PIPELINE.map((p, idx) => {
          const value = p.statuses.join(',');
          const active = status === value;
          return (
            <button key={p.key} type="button" onClick={() => { setStatus(active ? '' : value); setPage(1); }}
              className={cx('group relative overflow-hidden rounded-2xl p-4 text-left shadow-sm ring-1 transition', active ? 'bg-brand-900 text-white ring-brand-900' : 'bg-white ring-slate-900/5 hover:-translate-y-0.5 hover:shadow-md')}>
              <div className="flex items-center justify-between">
                <span className={cx('grid size-9 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm', p.tone)}><p.icon className="size-4" /></span>
                {idx < PIPELINE.length - 1 && <ArrowRight className={cx('hidden size-4 md:block', active ? 'text-brand-200' : 'text-slate-300')} />}
              </div>
              {counts[idx] === null ? <span className="mt-3 block h-7 w-12 animate-pulse rounded-lg bg-slate-100" /> : <p className="mt-3 font-display text-2xl font-bold tabular-nums">{counts[idx]}</p>}
              <p className={cx('text-xs font-medium', active ? 'text-brand-100' : 'text-slate-500')}>{p.label}</p>
            </button>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <SearchField className="lg:w-80" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Name, email or reference" />
          <Select className="h-10 lg:w-56" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Stage">
            <option value="">All stages</option>
            {PIPELINE.map((p) => <option key={p.key} value={p.statuses.join(',')}>{p.label} (all)</option>)}
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {filtered && <button type="button" onClick={() => { setStatus(''); setSearch(''); setPage(1); }} className="text-xs font-semibold text-slate-500 hover:text-slate-800 hover:underline lg:ml-auto">Clear filters</button>}
        </div>

        {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading applications" /> : rows.length === 0 ? (
          <EmptyState icon={Inbox} title={filtered ? 'No applications match' : 'No applications yet'} description={filtered ? 'Try another stage or search.' : 'Share your careers page link so people can apply.'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((a) => {
              const step = stepOf(a.status);
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => setOpenId(a.id)} className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-brand-50/40 focus-visible:bg-brand-50/60 focus-visible:outline-none">
                    <Avatar name={a.name} />
                    <span className="min-w-48 flex-1">
                      <span className="block font-medium text-slate-900">{a.name}</span>
                      <span className="block truncate text-xs text-slate-400"><span className="font-mono">{a.reference}</span> · {a.email}</span>
                    </span>
                    <span className="min-w-40">
                      <span className="flex items-center gap-1.5 text-sm text-slate-700"><Briefcase className="size-3.5 text-slate-400" />{a.vacancy?.title ?? '—'}</span>
                      <span className="mt-0.5 block"><BranchTag id={a.branch_id} /></span>
                    </span>
                    <span className="flex w-44 flex-col gap-1">
                      <Badge status={STATUS_TONE[a.status] ?? 'draft'}>{a.status_label}</Badge>
                      {step !== null && (
                        <span className="flex gap-0.5" title={`Step ${step} of 6`}>
                          {[1, 2, 3, 4, 5, 6].map((n) => <span key={n} className={cx('h-1 flex-1 rounded-full', n < step ? 'bg-brand-500' : n === step ? 'bg-sun-400' : 'bg-slate-200')} />)}
                        </span>
                      )}
                    </span>
                    <span className="w-24 text-right text-xs text-slate-400">{daysAgo(a.created_at)}</span>
                    <ChevronRight className="size-4 -translate-x-1 text-slate-300 opacity-0 transition group-hover:translate-x-0 group-hover:text-brand-600 group-hover:opacity-100" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>
      {openId !== null && <ApplicationDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

type DetailTab = 'overview' | 'interviews' | 'documents' | 'history';

function ApplicationDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useTenantQuery<{ data: JobApplication }>(`/applications/${id}`);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [issued, setIssued] = useState<Credentials | null>(null);
  const app = detail.data?.data;

  if (issued) {
    return (
      <Modal open onClose={onClose} title="Employee account created" icon={KeyRound} size="md" footer={<><Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => printDocument()}>Print slip</Button><Button onClick={onClose}>Done</Button></>}>
        <CredentialSlip credentials={issued} />
      </Modal>
    );
  }
  if (!app) {
    return <Modal open onClose={onClose} title="Application" icon={Inbox}>{detail.error ? <ErrorBanner error={detail.error} /> : <LoadingRows rows={3} />}</Modal>;
  }

  return (
    <Modal open onClose={onClose} title={app.name} description={<><span className="font-mono">{app.reference}</span> · applied {formatDateTime(app.created_at)}</>} size="xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gradient-to-br from-brand-50 to-cream/60 p-4 ring-1 ring-brand-100">
          <Avatar name={app.name} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-display font-semibold text-slate-900">{app.vacancy?.title ?? 'Application'}<Badge status={STATUS_TONE[app.status] ?? 'draft'}>{app.status_label}</Badge></p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500"><BranchTag id={app.branch_id} />Role on hire: {app.vacancy?.role?.name ?? '—'}</p>
          </div>
          <div className="flex gap-2 text-xs">
            {app.email && <a href={`mailto:${app.email}`} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 font-medium text-slate-600 ring-1 ring-slate-200 hover:text-brand-700"><Mail className="size-3.5" />Email</a>}
            {app.phone && <a href={`tel:${app.phone}`} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 font-medium text-slate-600 ring-1 ring-slate-200 hover:text-brand-700"><Phone className="size-3.5" />Call</a>}
          </div>
        </div>
        <HiringSteps current={stepOf(app.status)} closedLabel={app.closed_at ? `Closed: ${app.status_label}` : undefined} />
        <NextStep app={app} onProvisioned={setIssued} />
        <Tabs<DetailTab> value={tab} onChange={setTab} tabs={[
          { value: 'overview', label: 'Applicant', icon: UserRound },
          { value: 'interviews', label: 'Interviews', icon: MessagesSquare, count: app.interviews?.length ?? 0 },
          { value: 'documents', label: 'Documents', icon: FileText, count: app.documents?.length ?? 0 },
          { value: 'history', label: 'History', icon: HistoryIcon },
        ]} />
        {tab === 'overview' && <Overview app={app} />}
        {tab === 'interviews' && <Interviews app={app} />}
        {tab === 'documents' && <Documents app={app} />}
        {tab === 'history' && <History app={app} />}
      </div>
    </Modal>
  );
}

function Overview({ app }: { app: JobApplication }) {
  const info = (label: string, value: ReactNode) => <div className="h-full rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100"><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt><dd className="mt-0.5 whitespace-pre-line text-sm text-slate-900">{value || '—'}</dd></div>;
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {info('Email', app.email)}
      {info('Mobile', app.phone)}
      {info('Address', app.address)}
      {info('Birth date', formatDate(app.birth_date))}
      {info('Availability', app.availability)}
      {info('Applied', formatDateTime(app.created_at))}
      <div className="sm:col-span-2">{info('Work experience', app.work_experience)}</div>
      <div className="sm:col-span-2">{info('Cover letter', app.cover_letter)}</div>
      {app.offer && <div className="sm:col-span-2">{info('Offer', `${app.offer.position}, start ${formatDate(app.offer.start_date)}${app.offer.salary ? `, ${formatMoney(app.offer.salary)}` : ''}${app.offer.responded_at ? ` — answered ${formatDateTime(app.offer.responded_at)} (${app.offer.response_source})` : ''}`)}</div>}
      {app.rejection_reason && <div className="sm:col-span-2">{info('Internal reason (not shown to applicant)', app.rejection_reason)}</div>}
    </dl>
  );
}

function Interviews({ app }: { app: JobApplication }) {
  if (!app.interviews?.length) return <EmptyState icon={MessagesSquare} title="No interviews yet" description="Interviews appear here once they are scheduled." />;
  return (
    <ul className="space-y-3">
      {app.interviews.map((i) => (
        <li key={i.id} className="rounded-xl border border-slate-200 p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-slate-900">{i.stage_label} · round {i.round}</p>
            <Badge status={i.status === 'completed' ? 'active' : i.status === 'cancelled' || i.status === 'no_show' ? 'cancelled' : 'open'}>{titleCase(i.status)}</Badge>
          </div>
          <p className="text-slate-600">{formatDateTime(i.scheduled_at)} · {MODE_LABELS[i.mode]}{i.location ? ` · ${i.location}` : ''} · Interviewer: {i.interviewer_name}{i.reschedule_count ? ` · rescheduled ${i.reschedule_count}×` : ''}</p>
          {i.cancel_reason && <p className="text-xs text-slate-500">Cancelled: {i.cancel_reason}</p>}
          {i.decision && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p><strong>{DECISION_LABELS[i.decision] ?? i.decision}</strong> · {formatDateTime(i.decided_at)}</p>
                <span className="flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" style={{ width: `${i.score ?? 0}%` }} /></span><span className="text-xs font-semibold tabular-nums text-slate-700">{i.score}/100</span></span>
              </div>
              {i.criteria?.length ? <p className="text-xs text-slate-600">{i.criteria.map((c) => `${c.name}: ${c.score}/5`).join(' · ')}</p> : null}
              {i.feedback && <p className="mt-1 whitespace-pre-line text-slate-700">{i.feedback}</p>}
              {i.decision_reason && <p className="mt-1 text-xs text-slate-600">Reason: {i.decision_reason}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Documents({ app }: { app: JobApplication }) {
  const { can, path } = useTenant();
  const toast = useToast();
  const [type, setType] = useState('other');
  const [file, setFile] = useState<File | null>(null);
  const verify = useTenantMutation<{ docId: number; verified: boolean }>('POST', (b) => `/applications/${app.id}/documents/${b.docId}/verify`, { success: 'Document updated.' });
  const upload = useTenantMutation<FormData>('POST', `/applications/${app.id}/documents`, { success: 'Document uploaded.', onSuccess: () => setFile(null) });
  const required = new Set(app.vacancy?.required_documents ?? []);
  const hr = can('recruitment.hr');

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
        {app.documents?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
            <span className="flex items-center gap-3">
              <span className={cx('grid size-9 shrink-0 place-items-center rounded-lg', d.verified_at ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}><FileText className="size-4" /></span>
              <span>
              <span className="font-medium text-slate-900">{d.type_label}</span>
              {required.has(d.type) && <span className="ml-1 text-xs text-amber-700">required</span>}
              <span className="block text-xs text-slate-500">{d.original_name} · {(d.size / 1024).toFixed(0)} KB · by {d.uploaded_by_type}</span>
              </span>
            </span>
            <span className="flex items-center gap-2">
              {d.verified_at ? <Badge status="active">Verified</Badge> : <Badge status="draft">Not verified</Badge>}
              <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadFile(path(`/applications/${app.id}/documents/${d.id}`), d.original_name).catch((e) => toast.error(String(e.message)))}>Open</Button>
              {hr && <Button size="sm" variant="secondary" onClick={() => verify.mutate({ docId: d.id, verified: !d.verified_at })}>{d.verified_at ? 'Unverify' : 'Verify'}</Button>}
            </span>
          </li>
        ))}
      </ul>
      {hr && !app.closed_at && (
        <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <Field label="Add document">{(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(DOCUMENT_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
          <Field label="File">{(id) => <Input id={id} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
          <Button loading={upload.isPending} disabled={!file} onClick={() => { const f = new FormData(); f.append('type', type); f.append('file', file as File); upload.mutate(f); }}>Upload</Button>
        </div>
      )}
    </div>
  );
}

function History({ app }: { app: JobApplication }) {
  return (
    <ol className="relative space-y-4 pl-6 text-sm before:absolute before:bottom-1 before:left-[0.4rem] before:top-1 before:w-px before:bg-slate-200">
      {app.events?.map((e) => (
        <li key={e.id} className="relative">
          <span className={cx('absolute -left-6 top-1 size-3.5 rounded-full ring-4 ring-white', e.actor_type === 'applicant' ? 'bg-sky-500' : e.actor_type === 'system' ? 'bg-slate-300' : 'bg-brand-500')} />
          <p className="text-slate-900">
            <span className="font-medium">{titleCase(e.action.replaceAll('_', ' '))}</span>
            {e.to_label && e.from_status !== e.to_status && <span className="text-slate-500"> → {e.to_label}</span>}
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(e.created_at)} · {e.actor_type === 'staff' ? e.actor_name ?? 'Staff' : e.actor_type === 'applicant' ? 'Applicant' : 'System'}</p>
          {e.note && <p className="text-xs text-slate-600">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/* --------------------------------------------------------------------------- Next step (actions) */

function NextStep({ app, onProvisioned }: { app: JobApplication; onProvisioned: (c: Credentials) => void }) {
  const { can, membershipId } = useTenant();
  const hr = can('recruitment.hr');
  const finalAuthority = can('recruitment.final_approval');
  const post = useTenantMutation<{ action: string } & Record<string, unknown>, unknown>('POST', (b) => `/applications/${app.id}/${b.action}`, { success: 'Saved.', toastErrors: false });
  const run = (action: string, body: Record<string, unknown> = {}) => post.mutate({ action, ...body });
  const status = app.status;
  const openInterview = app.interviews?.find((i) => i.stage === status && (i.status === 'scheduled' || i.status === 'reschedule_requested'));
  const canSchedule = hr || (status === 'manager_interview' && can('recruitment.manager_interview')) || (status === 'owner_final_interview' && finalAuthority);

  let body: ReactNode = null;
  if (app.closed_at) {
    body = <p className="text-sm text-slate-600">This application is closed ({app.status_label}).{app.hired_membership_id ? ' The employee now appears on the Team page.' : ''}</p>;
  } else if (status === 'submitted') {
    body = hr ? <Button onClick={() => run('start-screening')} loading={post.isPending}>Start HR screening</Button> : <Waiting who="HR" what="screen the application" />;
  } else if (status === 'hr_screening') {
    body = hr ? <ScreeningForm onSubmit={(b) => run('screen', b)} busy={post.isPending} /> : <Waiting who="HR" what="finish screening" />;
  } else if (status === 'incomplete') {
    body = (
      <div className="space-y-2 text-sm">
        <p>Waiting for the applicant. Message sent: <em>{app.applicant_message}</em></p>
        {hr && <Button onClick={() => run('resume')} loading={post.isPending}>Continue — return to {STATUS_LABELS[app.return_status ?? 'hr_screening']}</Button>}
      </div>
    );
  } else if (status === 'hr_interview' || status === 'manager_interview' || status === 'owner_final_interview') {
    body = openInterview ? (
      <OpenInterview app={app} interview={openInterview} mine={openInterview.interviewer_membership_id === membershipId} canManage={canSchedule} />
    ) : canSchedule ? (
      <ScheduleForm app={app} stage={status} />
    ) : (
      <Waiting who={status === 'manager_interview' ? 'HR or the branch manager' : 'HR'} what="schedule the interview" />
    );
  } else if (status === 'approved') {
    body = hr ? <OfferForm onSubmit={(b) => run('offer', b)} busy={post.isPending} defaultPosition={app.vacancy?.title ?? ''} /> : <Waiting who="HR" what="send the job offer" />;
  } else if (status === 'offer_sent') {
    body = (
      <div className="space-y-2 text-sm">
        <p>Offer sent {formatDateTime(app.offer?.sent_at)}. The applicant can accept or decline from their application page.</p>
        {hr && <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => run('offer-response', { accepted: true, note: 'Accepted in person' })}>Record: accepted</Button><Button size="sm" variant="secondary" onClick={() => confirm('Record that the applicant declined?') && run('offer-response', { accepted: false, note: 'Declined' })}>Record: declined</Button></div>}
      </div>
    );
  } else if (status === 'offer_accepted') {
    body = hr ? <Button onClick={() => run('onboarding')} loading={post.isPending}>Start onboarding</Button> : <Waiting who="HR" what="start onboarding" />;
  } else if (status === 'onboarding') {
    body = <Onboarding app={app} onProvisioned={onProvisioned} />;
  }

  // Owner (holds every permission) and final approvers may reject at any stage before the offer; HR during screening.
  const canReject = !app.closed_at && !['offer_sent', 'offer_accepted', 'onboarding'].includes(status) && (finalAuthority || (hr && (status === 'hr_screening' || status === 'incomplete')));
  const canClarify = hr && ['hr_interview', 'manager_interview', 'owner_final_interview'].includes(status);
  const canAnother = hr && (status === 'manager_interview' || status === 'owner_final_interview');

  return (
    <section className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/80 to-white p-4 shadow-sm">
      <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700"><span className="grid size-6 place-items-center rounded-lg bg-brand-600 text-white"><ArrowRight className="size-3.5" /></span>Next step</p>
      {post.error instanceof ApiError && <ErrorBanner error={post.error} className="mb-3" />}
      {body}
      {(canReject || canClarify || canAnother || (hr && !app.closed_at)) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-brand-100 pt-3">
          {canClarify && <PromptButton label="Ask applicant for clarification" field="applicant_message" placeholder="What should the applicant provide or explain?" onSubmit={(v) => run('clarification', { applicant_message: v })} />}
          {canAnother && <AnotherInterviewButton current={status} onSubmit={(stage, reason) => run('another-interview', { stage, reason })} />}
          {canReject && <PromptButton label="Reject" danger field="reason" placeholder="Internal reason (the applicant only sees 'Not selected')" onSubmit={(v) => run('reject', { reason: v })} />}
          {hr && !app.closed_at && status !== 'hired' && <PromptButton label="Withdraw (applicant's request)" field="reason" placeholder="How did the applicant ask to withdraw?" onSubmit={(v) => run('withdraw', { reason: v })} />}
        </div>
      )}
    </section>
  );
}

function Waiting({ who, what }: { who: string; what: string }) {
  return <p className="flex items-center gap-2 text-sm text-slate-600"><Clock className="size-4 text-slate-400" />Waiting for {who} to {what}.</p>;
}

function PromptButton({ label, placeholder, onSubmit, danger }: { label: string; field: string; placeholder: string; onSubmit: (value: string) => void; danger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open) return <Button size="sm" variant={danger ? 'danger' : 'secondary'} onClick={() => setOpen(true)}>{label}</Button>;
  return (
    <div className="w-full space-y-2">
      <Textarea rows={2} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus />
      <div className="flex gap-2">
        <Button size="sm" variant={danger ? 'danger' : 'primary'} disabled={!value.trim()} onClick={() => { onSubmit(value.trim()); setOpen(false); setValue(''); }}>{label}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function AnotherInterviewButton({ current, onSubmit }: { current: ApplicationStatus; onSubmit: (stage: string, reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<string>(current);
  const [reason, setReason] = useState('');
  const stages: InterviewStage[] = current === 'owner_final_interview' ? ['hr_interview', 'manager_interview', 'owner_final_interview'] : ['hr_interview', 'manager_interview'];
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Request another interview</Button>;
  return (
    <div className="grid w-full gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
      <Field label="Stage">{(id) => <Select id={id} value={stage} onChange={(e) => setStage(e.target.value)}>{stages.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select>}</Field>
      <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <div className="flex gap-2"><Button size="sm" disabled={!reason} onClick={() => { onSubmit(stage, reason); setOpen(false); }}>Request</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </div>
  );
}

function ScreeningForm({ onSubmit, busy }: { onSubmit: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [decision, setDecision] = useState<'pass' | 'incomplete' | 'reject'>('pass');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-700">Check completeness, documents and minimum qualifications.</p>
      <div className="flex flex-wrap gap-4">
        {([['pass', 'Passed — schedule HR interview'], ['incomplete', 'Incomplete — ask the applicant'], ['reject', 'Does not qualify — reject']] as const).map(([v, l]) => (
          <label key={v} className={cx('flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 ring-1 transition', decision === v ? 'bg-brand-50 ring-brand-400' : 'bg-white ring-slate-200 hover:bg-slate-50')}><input type="radio" className="accent-brand-600" checked={decision === v} onChange={() => setDecision(v)} />{l}</label>
        ))}
      </div>
      {decision === 'incomplete' && <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message to the applicant: what is missing?" />}
      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision === 'reject' ? 'Internal reason (required)' : 'Internal note (optional)'} />
      <Button loading={busy} disabled={(decision === 'incomplete' && !message) || (decision === 'reject' && !note)} onClick={() => onSubmit({ decision, note: note || null, applicant_message: message || null })}>Save screening result</Button>
    </div>
  );
}

function ScheduleForm({ app, stage }: { app: JobApplication; stage: InterviewStage }) {
  const interviewers = useTenantQuery<{ data: { membership_id: number; name: string; roles: string[] }[] }>(`/applications/${app.id}/interviewers`, { stage });
  const [form, setForm] = useState({ interviewer_membership_id: '', scheduled_at: '', mode: 'in_person', location: '' });
  const schedule = useTenantMutation<Record<string, unknown>>('POST', `/applications/${app.id}/interviews`, { success: 'Interview scheduled. The applicant and interviewer were notified.', toastErrors: false });
  const err = (f: string) => (schedule.error instanceof ApiError ? schedule.error.field(f) : undefined);
  const round = (app.interviews?.filter((i) => i.stage === stage).length ?? 0) + 1;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">Schedule the {STATUS_LABELS[stage].toLowerCase()}{round > 1 ? ` (round ${round})` : ''}.</p>
      {schedule.error instanceof ApiError && !Object.keys(schedule.error.errors).length && <ErrorBanner error={schedule.error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Interviewer" error={err('interviewer_membership_id')} hint={interviewers.data?.data.length === 0 ? 'Nobody with access to this branch can conduct this stage.' : undefined}>
          {(id) => (
            <Select id={id} value={form.interviewer_membership_id} onChange={(e) => setForm((f) => ({ ...f, interviewer_membership_id: e.target.value }))}>
              <option value="">Choose…</option>
              {interviewers.data?.data.map((m) => <option key={m.membership_id} value={m.membership_id}>{m.name} ({m.roles.join(', ')})</option>)}
            </Select>
          )}
        </Field>
        <Field label="Date and time" error={err('scheduled_at')}>{(id) => <Input id={id} type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))} />}</Field>
        <Field label="Format">{(id) => <Select id={id} value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}>{Object.entries(MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
        <Field label="Location or link" error={err('location')}>{(id) => <Input id={id} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />}</Field>
      </div>
      <Button loading={schedule.isPending} disabled={!form.interviewer_membership_id || !form.scheduled_at} onClick={() => schedule.mutate({
        interviewer_membership_id: Number(form.interviewer_membership_id),
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        mode: form.mode,
        location: form.location || null,
      })}>Schedule interview</Button>
    </div>
  );
}

function OpenInterview({ app, interview, mine, canManage }: { app: JobApplication; interview: Interview; mine: boolean; canManage: boolean }) {
  const [mode, setMode] = useState<'view' | 'reschedule' | 'result'>('view');
  const act = useTenantMutation<{ action: string } & Record<string, unknown>>('POST', (b) => `/applications/${app.id}/interviews/${interview.id}/${b.action}`, { success: 'Saved.', toastErrors: false });
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-3 text-sm">
      <p>
        <strong>{interview.stage_label}</strong>{interview.round > 1 ? ` (round ${interview.round})` : ''} with {interview.interviewer_name} — {formatDateTime(interview.scheduled_at)}, {MODE_LABELS[interview.mode]}{interview.location ? `, ${interview.location}` : ''}
      </p>
      {interview.status === 'reschedule_requested' && <p className="rounded bg-amber-50 p-2 text-amber-900">The applicant asked for another schedule. Please reschedule.</p>}
      {act.error instanceof ApiError && <ErrorBanner error={act.error} />}
      {mode === 'view' && (
        <div className="flex flex-wrap gap-2">
          {mine && interview.status === 'scheduled' && <Button size="sm" onClick={() => setMode('result')}>Record interview result</Button>}
          {!mine && <span className="self-center text-slate-500">Only {interview.interviewer_name} can record the result.</span>}
          {canManage && <Button size="sm" variant="secondary" onClick={() => setMode('reschedule')}>Reschedule</Button>}
          {canManage && <Button size="sm" variant="secondary" onClick={() => { const r = prompt('Why is this interview cancelled?'); if (r) act.mutate({ action: 'cancel', reason: r }); }}>Cancel interview</Button>}
          {(mine || canManage) && interview.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => confirm('Mark the applicant as a no-show?') && act.mutate({ action: 'no-show' })}>Applicant did not show up</Button>}
        </div>
      )}
      {mode === 'reschedule' && (
        <div className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <Field label="New date and time">{(id) => <Input id={id} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
          <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button size="sm" loading={act.isPending} disabled={!when || !reason} onClick={() => act.mutate({ action: 'reschedule', scheduled_at: new Date(when).toISOString(), reason }, { onSuccess: () => setMode('view') })}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
          </div>
        </div>
      )}
      {mode === 'result' && <ResultForm stage={interview.stage} busy={act.isPending} onCancel={() => setMode('view')} onSubmit={(b) => act.mutate({ action: 'result', ...b }, { onSuccess: () => setMode('view') })} />}
    </div>
  );
}

const DEFAULT_CRITERIA: Record<InterviewStage, string[]> = {
  hr_interview: ['Qualifications', 'Communication', 'Work experience', 'Availability', 'Documents complete'],
  manager_interview: ['Job-specific skills', 'Practical knowledge', 'Fit for branch needs', 'Suitability for position'],
  owner_final_interview: ['Overall fit', 'Expectations aligned', 'Previous interview feedback'],
};

function ResultForm({ stage, busy, onSubmit, onCancel }: { stage: InterviewStage; busy: boolean; onSubmit: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA[stage].map((name) => ({ name, score: 3 })));
  const [decision, setDecision] = useState(DECISIONS[stage][0].value);
  const [feedback, setFeedback] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [nextStage, setNextStage] = useState<InterviewStage>('manager_interview');
  const score = Math.round((criteria.reduce((s, c) => s + c.score, 0) / (criteria.length * 5)) * 100);
  const needsReason = !['pass', 'recommend', 'approve'].includes(decision);

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {criteria.map((c, i) => (
          <div key={c.name} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-slate-700">{c.name}</span>
            <span className="flex gap-1" role="radiogroup" aria-label={c.name}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={c.score === n} onClick={() => setCriteria((list) => list.map((x, j) => (j === i ? { ...x, score: n } : x)))}
                  className={cx('grid size-7 place-items-center rounded-lg text-xs font-semibold transition', n <= c.score ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200')}>{n}</button>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
        <span className="text-sm text-slate-600">Overall score</span>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-300" style={{ width: `${score}%` }} /></span>
        <strong className="font-display tabular-nums text-brand-900">{score}/100</strong>
      </div>
      <Field label="Feedback (confidential — never shown to the applicant)">{(id) => <Textarea id={id} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />}</Field>
      <div className="flex flex-wrap gap-4 text-sm">
        {DECISIONS[stage].map((d) => (
          <label key={d.value} className={cx('flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 ring-1 transition', decision === d.value ? 'bg-brand-50 ring-brand-400' : 'bg-white ring-slate-200 hover:bg-slate-50')}><input type="radio" className="accent-brand-600" checked={decision === d.value} onChange={() => setDecision(d.value)} />{d.label}</label>
        ))}
      </div>
      {needsReason && <Field label="Reason (internal)">{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
      {decision === 'request_info' && <Field label="Message to the applicant">{(id) => <Textarea id={id} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>}
      {decision === 'another_interview' && (
        <Field label="Which interview should happen again?">
          {(id) => <Select id={id} value={nextStage} onChange={(e) => setNextStage(e.target.value as InterviewStage)}>{(['hr_interview', 'manager_interview', 'owner_final_interview'] as const).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select>}
        </Field>
      )}
      <div className="flex gap-2">
        <Button loading={busy} disabled={!feedback || (needsReason && !reason) || (decision === 'request_info' && !message)} onClick={() => onSubmit({
          decision, score, criteria, feedback, reason: reason || null,
          applicant_message: decision === 'request_info' ? message : null,
          next_stage: decision === 'another_interview' ? nextStage : null,
        })}>Save result</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function OfferForm({ onSubmit, busy, defaultPosition }: { onSubmit: (b: Record<string, unknown>) => void; busy: boolean; defaultPosition: string }) {
  const [form, setForm] = useState({ position: defaultPosition, salary: '', start_date: '', terms: '' });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">Hiring approved. Prepare the job offer — the applicant sees these details and can accept online.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Position">{(id) => <Input id={id} value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} />}</Field>
        <Field label="Monthly salary (₱, optional)">{(id) => <Input id={id} inputMode="decimal" value={form.salary} onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))} />}</Field>
        <Field label="Start date">{(id) => <Input id={id} type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />}</Field>
      </div>
      <Field label="Terms (shown to the applicant)">{(id) => <Textarea id={id} rows={3} value={form.terms} onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))} placeholder="e.g. 6-month probation, 6 days a week, benefits…" />}</Field>
      <Button loading={busy} disabled={!form.position || !form.start_date} onClick={() => onSubmit({ ...form, salary: form.salary || null, terms: form.terms || null })}>Send offer</Button>
    </div>
  );
}

function Onboarding({ app, onProvisioned }: { app: JobApplication; onProvisioned: (c: Credentials) => void }) {
  const { can } = useTenant();
  const task = useTenantMutation<{ taskId: number; done: boolean }>('PATCH', (b) => `/applications/${app.id}/onboarding-tasks/${b.taskId}`, {});
  const [email, setEmail] = useState(app.email);
  const [requireChange, setRequireChange] = useState(false);
  const roles = useTenantQuery<{ data: Role[] }>('/roles');
  const role = roles.data?.data.find((r) => r.id === app.vacancy?.role?.id);
  const emailNeeded = !!role?.requires_email_sign_in;
  const provision = useTenantMutation<Record<string, unknown>, IssuedResponse>('POST', `/applications/${app.id}/provision`, { success: 'Employee account created.', onSuccess: (r) => onProvisioned(toCredentials(r)), toastErrors: false });
  const blockers = app.provisioning_blockers ?? [];

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-2 font-medium text-slate-800">Onboarding checklist</p>
        {app.onboarding_tasks?.length ? (
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" style={{ width: `${(app.onboarding_tasks.filter((t) => t.completed_at).length / app.onboarding_tasks.length) * 100}%` }} /></span>
            {app.onboarding_tasks.filter((t) => t.completed_at).length}/{app.onboarding_tasks.length} done
          </div>
        ) : null}
        <ul className="space-y-1">
          {app.onboarding_tasks?.map((t) => (
            <li key={t.id}>
              <Checkbox label={`${t.label}${t.required ? '' : ' (optional)'}`} checked={!!t.completed_at} disabled={!can('recruitment.hr')} onChange={(v) => task.mutate({ taskId: t.id, done: v })} />
            </li>
          ))}
        </ul>
      </div>
      {blockers.length > 0 ? (
        <div className="rounded-xl bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-100">
          <p className="font-medium">Before the SmartPOS account can be created:</p>
          <ul className="ml-4 list-disc">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <p className="mt-1 text-xs">Verify documents in the Documents tab.</p>
        </div>
      ) : can('staff.create') ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-medium text-slate-800">Create SmartPOS account — {app.vacancy?.role?.name} at {app.branch?.name}</p>
          {provision.error instanceof ApiError && <ErrorBanner error={provision.error} />}
          <Field label={emailNeeded ? 'Email (required — signs in with email)' : 'Email (optional)'}>{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Checkbox label="Ask the employee to change the password at first sign-in" checked={requireChange} onChange={setRequireChange} />
          <Button loading={provision.isPending} disabled={emailNeeded && !email} onClick={() => provision.mutate({ email: email || null, delivery: 'temporary_password', require_password_change: requireChange })}>Create account and print sign-in slip</Button>
        </div>
      ) : (
        <p className="text-slate-600">Ready. An account administrator can now create the SmartPOS account.</p>
      )}
    </div>
  );
}

/* =========================================================================== Vacancies */

function VacanciesTab() {
  const { can, scopeBranchId } = useTenant();
  const list = useTenantQuery<{ data: Vacancy[] }>('/vacancies', { branch_id: scopeBranchId });
  const [editing, setEditing] = useState<Vacancy | 'new' | null>(null);
  const manage = can('recruitment.vacancies');
  const rows = list.data?.data ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500"><strong className="text-slate-800">{rows.filter((v) => v.status === 'open').length}</strong> open of {rows.length} vacancies. Only open ones appear on the careers page.</p>
        {manage && <Button className="ml-auto" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>New vacancy</Button>}
      </div>
      {list.error ? <ErrorBanner error={list.error} /> : list.isPending ? <LoadingRows label="Loading vacancies" /> : rows.length === 0 ? (
        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
          <EmptyState icon={Briefcase} title="No vacancies yet" description="Post a vacancy and it will appear on your careers page."
            action={manage && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>New vacancy</Button>} />
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((v) => {
            const apps = v.applications_count ?? 0;
            return (
              <article key={v.id} className={cx('group flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 transition', v.status === 'open' ? 'ring-slate-900/5 hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-200' : 'opacity-80 ring-slate-200')}>
                <div className="flex items-start gap-3">
                  <span className={cx('grid size-11 shrink-0 place-items-center rounded-xl', v.status === 'open' ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm' : 'bg-slate-100 text-slate-400')}><Briefcase className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-semibold text-slate-900">{v.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5"><BranchTag id={v.branch_id} /><span className="text-xs text-slate-400">{titleCase(v.employment_type)}</span></p>
                  </div>
                  <Badge status={v.status} />
                </div>
                {v.description && <p className="mt-3 line-clamp-2 text-sm text-slate-500">{v.description}</p>}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-slate-50 py-2 ring-1 ring-slate-100"><p className="font-display font-bold tabular-nums text-slate-900">{v.slots}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Openings</p></div>
                  <div className="rounded-xl bg-slate-50 py-2 ring-1 ring-slate-100"><p className="font-display font-bold tabular-nums text-slate-900">{apps}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Applicants</p></div>
                  <div className="rounded-xl bg-slate-50 py-2 ring-1 ring-slate-100"><p className="font-display font-bold tabular-nums text-slate-900">{v.required_documents.length}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Documents</p></div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-slate-500"><UserRound className="size-3.5" />Hired as {v.role?.name ?? '—'}</span>
                  {manage && <Button size="sm" variant="ghost" onClick={() => setEditing(v)}>Edit</Button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editing && <VacancyForm vacancy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function VacancyForm({ vacancy, onClose }: { vacancy: Vacancy | null; onClose: () => void }) {
  const { branches, branch } = useTenant();
  const roles = useTenantQuery<{ data: Role[] }>('/roles');
  const [form, setForm] = useState({
    title: vacancy?.title ?? '',
    description: vacancy?.description ?? '',
    requirements: vacancy?.requirements ?? '',
    employment_type: vacancy?.employment_type ?? 'full_time',
    slots: String(vacancy?.slots ?? 1),
    status: vacancy?.status ?? 'open',
    branch_id: String(vacancy?.branch_id ?? branch?.id ?? branches[0]?.id ?? ''),
    role_id: String(vacancy?.role_id ?? ''),
  });
  const [docs, setDocs] = useState<string[]>(vacancy?.required_documents.map((d) => d.type) ?? ['resume', 'valid_id']);
  useEffect(() => {
    if (!form.role_id && roles.data) setForm((f) => ({ ...f, role_id: String(roles.data.data.find((r) => r.key === 'cashier')?.id ?? '') }));
  }, [roles.data, form.role_id]);
  const save = useTenantMutation<Record<string, unknown>>(vacancy ? 'PATCH' : 'POST', vacancy ? `/vacancies/${vacancy.id}` : '/vacancies', { success: 'Vacancy saved.', onSuccess: onClose, toastErrors: false });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal open onClose={onClose} title={vacancy ? 'Edit vacancy' : 'New vacancy'} icon={Briefcase} description="Open vacancies are listed on your public careers page." size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate({ ...form, slots: Number(form.slots), branch_id: Number(form.branch_id), role_id: Number(form.role_id), required_documents: docs })}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {save.error instanceof ApiError && !Object.keys(save.error.errors).length && <ErrorBanner error={save.error} className="sm:col-span-2" />}
        <Field label="Position title" error={err('title')}>{(id) => <Input id={id} value={form.title} onChange={set('title')} />}</Field>
        <Field label="Status" error={err('status')} hint="Only open vacancies appear on the careers page.">{(id) => <Select id={id} value={form.status} onChange={set('status')}><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></Select>}</Field>
        <Field label="Branch" error={err('branch_id')}>{(id) => <Select id={id} value={form.branch_id} onChange={set('branch_id')}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
        <Field label="SmartPOS role on hire" error={err('role_id')}>{(id) => <Select id={id} value={form.role_id} onChange={set('role_id')}><option value="">Choose…</option>{roles.data?.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>
        <Field label="Employment type">{(id) => <Select id={id} value={form.employment_type} onChange={set('employment_type')}>{['full_time', 'part_time', 'contractual', 'seasonal'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select>}</Field>
        <Field label="Openings" error={err('slots')}>{(id) => <Input id={id} inputMode="numeric" value={form.slots} onChange={set('slots')} />}</Field>
        <Field label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={form.description} onChange={set('description')} />}</Field>
        <Field label="Qualifications" className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={form.requirements} onChange={set('requirements')} />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-medium text-slate-700">Required documents</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(DOCUMENT_TYPES).filter(([t]) => t !== 'other').map(([t, l]) => {
              const on = docs.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on} onClick={() => setDocs((d) => (on ? d.filter((x) => x !== t) : [...d, t]))}
                  className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition', on ? 'bg-brand-50 text-brand-800 ring-brand-400' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
                  {on ? <Check className="size-3.5" /> : <FileText className="size-3.5 text-slate-400" />}{l}
                </button>
              );
            })}
          </div>
          {err('required_documents') && <p className="text-xs text-red-600">{err('required_documents')}</p>}
        </div>
      </div>
    </Modal>
  );
}
