import { Copy, Download, Plus, Printer } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { HiringSteps } from '../../components/HiringSteps';
import { useToast } from '../../components/Toast';
import { Badge, Button, Card, Checkbox, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Textarea } from '../../components/ui';
import { ApiError, downloadFile } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney, titleCase } from '../../lib/format';
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
        title="Recruitment"
        description="Applications move through HR screening, HR interview, branch manager interview and the owner's final interview before an offer and onboarding."
        actions={
          <Button variant="secondary" size="sm" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard?.writeText(careersUrl).then(() => toast.success('Careers page link copied.'))}>
            Copy careers page link
          </Button>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'applications', label: 'Applications' }, { value: 'vacancies', label: 'Vacancies' }]} />
      {tab === 'applications' ? <ApplicationsTab /> : <VacanciesTab />}
    </>
  );
}

/* =========================================================================== Applications */

function ApplicationsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useTenantQuery<Paginated<JobApplication>>('/applications', { page, status, q });

  return (
    <Card
      padded={false}
      actions={
        <div className="flex gap-2">
          <Input className="h-8 w-48" placeholder="Name, email or reference" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search" />
          <Select className="h-8 w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Stage">
            <option value="">All stages</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
      }
    >
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(a) => a.id}
        onRowClick={(a) => setOpenId(a.id)}
        empty="No applications yet. Share your careers page link so people can apply."
        columns={[
          { header: 'Applicant', cell: (a) => <><p className="font-medium text-slate-900">{a.name}</p><p className="text-xs text-slate-500">{a.reference} · {a.email}</p></> },
          { header: 'Position', cell: (a) => <>{a.vacancy?.title}<p className="text-xs text-slate-500">{a.branch?.name}</p></> },
          { header: 'Stage', cell: (a) => <Badge status={STATUS_TONE[a.status] ?? 'draft'}>{a.status_label}</Badge> },
          { header: 'Applied', cell: (a) => formatDate(a.created_at) },
        ]}
      />
      <Pagination page={page} data={list.data} onPage={setPage} />
      {openId !== null && <ApplicationDetail id={openId} onClose={() => setOpenId(null)} />}
    </Card>
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
      <Modal open onClose={onClose} title="Employee account created" size="md" footer={<><Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print slip</Button><Button onClick={onClose}>Done</Button></>}>
        <CredentialSlip credentials={issued} />
      </Modal>
    );
  }
  if (!app) {
    return <Modal open onClose={onClose} title="Application">{detail.error ? <ErrorBanner error={detail.error} /> : <p className="text-sm text-slate-500">Loading…</p>}</Modal>;
  }

  return (
    <Modal open onClose={onClose} title={`${app.name} — ${app.vacancy?.title ?? ''}`} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Badge status={STATUS_TONE[app.status] ?? 'draft'}>{app.status_label}</Badge>
          <span>{app.reference}</span>·<span>{app.branch?.name}</span>·<span>Role on hire: {app.vacancy?.role?.name ?? '—'}</span>
        </div>
        <HiringSteps current={stepOf(app.status)} closedLabel={app.closed_at ? `Closed: ${app.status_label}` : undefined} />
        <NextStep app={app} onProvisioned={setIssued} />
        <Tabs<DetailTab> value={tab} onChange={setTab} tabs={[
          { value: 'overview', label: 'Applicant' },
          { value: 'interviews', label: `Interviews (${app.interviews?.length ?? 0})` },
          { value: 'documents', label: `Documents (${app.documents?.length ?? 0})` },
          { value: 'history', label: 'History' },
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
  const info = (label: string, value: ReactNode) => <div><dt className="text-xs text-slate-500">{label}</dt><dd className="whitespace-pre-line text-sm text-slate-900">{value || '—'}</dd></div>;
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
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
  if (!app.interviews?.length) return <p className="text-sm text-slate-500">No interviews yet.</p>;
  return (
    <ul className="space-y-3">
      {app.interviews.map((i) => (
        <li key={i.id} className="rounded-lg border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-slate-900">{i.stage_label} · round {i.round}</p>
            <Badge status={i.status === 'completed' ? 'active' : i.status === 'cancelled' || i.status === 'no_show' ? 'cancelled' : 'open'}>{titleCase(i.status)}</Badge>
          </div>
          <p className="text-slate-600">{formatDateTime(i.scheduled_at)} · {MODE_LABELS[i.mode]}{i.location ? ` · ${i.location}` : ''} · Interviewer: {i.interviewer_name}{i.reschedule_count ? ` · rescheduled ${i.reschedule_count}×` : ''}</p>
          {i.cancel_reason && <p className="text-xs text-slate-500">Cancelled: {i.cancel_reason}</p>}
          {i.decision && (
            <div className="mt-2 rounded-md bg-slate-50 p-2">
              <p><strong>{DECISION_LABELS[i.decision] ?? i.decision}</strong> · score {i.score}/100 · {formatDateTime(i.decided_at)}</p>
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
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {app.documents?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span>
              <span className="font-medium text-slate-900">{d.type_label}</span>
              {required.has(d.type) && <span className="ml-1 text-xs text-amber-700">required</span>}
              <span className="block text-xs text-slate-500">{d.original_name} · {(d.size / 1024).toFixed(0)} KB · by {d.uploaded_by_type}</span>
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
    <ol className="space-y-2 border-l-2 border-slate-200 pl-4 text-sm">
      {app.events?.map((e) => (
        <li key={e.id}>
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
    <section className="rounded-lg border border-teal-200 bg-teal-50/40 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-teal-800">Next step</p>
      {post.error instanceof ApiError && <ErrorBanner error={post.error} className="mb-3" />}
      {body}
      {(canReject || canClarify || canAnother || (hr && !app.closed_at)) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-teal-100 pt-3">
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
  return <p className="text-sm text-slate-600">Waiting for {who} to {what}.</p>;
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
          <label key={v} className="flex items-center gap-2"><input type="radio" className="accent-teal-700" checked={decision === v} onChange={() => setDecision(v)} />{l}</label>
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
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {criteria.map((c, i) => (
          <label key={c.name} className="flex items-center justify-between gap-2 text-sm">
            <span>{c.name}</span>
            <select className="h-8 rounded border border-slate-300 px-1" value={c.score} onChange={(e) => setCriteria((list) => list.map((x, j) => (j === i ? { ...x, score: Number(e.target.value) } : x)))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="text-sm text-slate-600">Overall score: <strong>{score}/100</strong></p>
      <Field label="Feedback (confidential — never shown to the applicant)">{(id) => <Textarea id={id} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />}</Field>
      <div className="flex flex-wrap gap-4 text-sm">
        {DECISIONS[stage].map((d) => (
          <label key={d.value} className="flex items-center gap-2"><input type="radio" className="accent-teal-700" checked={decision === d.value} onChange={() => setDecision(d.value)} />{d.label}</label>
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
        <ul className="space-y-1">
          {app.onboarding_tasks?.map((t) => (
            <li key={t.id}>
              <Checkbox label={`${t.label}${t.required ? '' : ' (optional)'}`} checked={!!t.completed_at} disabled={!can('recruitment.hr')} onChange={(v) => task.mutate({ taskId: t.id, done: v })} />
            </li>
          ))}
        </ul>
      </div>
      {blockers.length > 0 ? (
        <div className="rounded-md bg-amber-50 p-3 text-amber-900">
          <p className="font-medium">Before the SmartPOS account can be created:</p>
          <ul className="ml-4 list-disc">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <p className="mt-1 text-xs">Verify documents in the Documents tab.</p>
        </div>
      ) : can('staff.create') ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
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
  const { can } = useTenant();
  const list = useTenantQuery<{ data: Vacancy[] }>('/vacancies');
  const [editing, setEditing] = useState<Vacancy | 'new' | null>(null);
  return (
    <Card padded={false} actions={can('recruitment.vacancies') ? <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>New vacancy</Button> : undefined}>
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(v) => v.id}
        onRowClick={can('recruitment.vacancies') ? setEditing : undefined}
        empty="No vacancies yet."
        columns={[
          { header: 'Position', cell: (v) => <span className="font-medium text-slate-900">{v.title}</span> },
          { header: 'Branch', cell: (v) => v.branch?.name },
          { header: 'Role on hire', cell: (v) => v.role?.name },
          { header: 'Applications', cell: (v) => v.applications_count ?? 0, align: 'right' },
          { header: 'Status', cell: (v) => <Badge status={v.status} /> },
        ]}
      />
      {editing && <VacancyForm vacancy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
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
    <Modal open onClose={onClose} title={vacancy ? 'Edit vacancy' : 'New vacancy'} size="lg"
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
          <div className="grid gap-1 sm:grid-cols-2">
            {Object.entries(DOCUMENT_TYPES).filter(([t]) => t !== 'other').map(([t, l]) => (
              <Checkbox key={t} label={l} checked={docs.includes(t)} onChange={(v) => setDocs((d) => (v ? [...d, t] : d.filter((x) => x !== t)))} />
            ))}
          </div>
          {err('required_documents') && <p className="text-xs text-red-600">{err('required_documents')}</p>}
        </div>
      </div>
    </Modal>
  );
}
