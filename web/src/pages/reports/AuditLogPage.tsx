import { useState } from 'react';
import { BranchTag } from '../../components/BranchSwitcher';
import { Card, DataTable, Input, Modal, PageHeader, Pagination } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useDebounced, useTenantQuery } from '../../lib/hooks';
import type { AuditLogEntry, Paginated } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

export function AuditLogPage() {
  const { can, viewAll, scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const a = useDebounced(action.trim());
  const list = useTenantQuery<Paginated<AuditLogEntry>>('/audit-logs', { action: a ? (a.includes('*') || a.includes('.') ? a : `${a}.*`) : undefined, branch_id: scopeBranchId, page });

  if (!can('audit_logs.view')) return <NoAccess what="the audit log" />;

  return (
    <>
      <PageHeader title="Audit log" description="Every sensitive action, who did it and when. Entries cannot be edited." />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <Input className="max-w-sm" placeholder="Filter by action, e.g. sale, refund.*, product.price_changed" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action filter" />
        </div>
        <DataTable
          rows={list.data?.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(r) => r.id}
          onRowClick={setSelected}
          empty="No entries."
          columns={[
            { header: 'When', cell: (r) => formatDateTime(r.created_at) },
            { header: 'Action', cell: (r) => <code className="text-xs">{r.action}</code> },
            { header: 'User', cell: (r) => r.user?.name ?? 'System' },
            ...(viewAll ? [{ header: 'Branch', cell: (r: AuditLogEntry) => (r.branch_id === null ? <span className="text-xs text-slate-400">Business-wide</span> : <BranchTag id={r.branch_id} />) }] : []),
            { header: 'Record', cell: (r) => (r.auditable_type ? `${r.auditable_type.split('\\').pop()} #${r.auditable_id}` : '—') },
            { header: 'IP', cell: (r) => <span className="text-xs text-slate-500">{r.ip_address}</span> },
          ]}
        />
        <Pagination page={page} data={list.data} onPage={setPage} />
      </Card>
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.action ?? ''} size="lg">
        {selected && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">{formatDateTime(selected.created_at)} · {selected.user?.name ?? 'System'}</p>
            {(['old_values', 'new_values', 'metadata'] as const).map((k) =>
              selected[k] ? (
                <div key={k}>
                  <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{k.replace('_', ' ')}</p>
                  <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(selected[k], null, 2)}</pre>
                </div>
              ) : null,
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
