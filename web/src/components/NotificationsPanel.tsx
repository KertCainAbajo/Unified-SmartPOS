import { useTenantMutation, useTenantQuery } from '../lib/hooks';
import { formatDateTime } from '../lib/format';
import type { AppNotification, Paginated } from '../lib/types';
import { Button, EmptyState, Modal, Spinner, cx } from './ui';

export function NotificationsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const list = useTenantQuery<Paginated<AppNotification>>('/notifications', { per_page: 30 }, { enabled: open });
  const readAll = useTenantMutation<void>('POST', '/notifications/read-all');
  const markRead = useTenantMutation<number>('POST', (id) => `/notifications/${id}/read`, { toastErrors: false });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Notifications"
      footer={
        <Button variant="secondary" size="sm" loading={readAll.isPending} onClick={() => readAll.mutate()}>
          Mark all as read
        </Button>
      }
    >
      {list.isPending ? (
        <Spinner />
      ) : !list.data?.data.length ? (
        <EmptyState title="No notifications" description="New online orders, deliveries, low-stock alerts and refund approvals appear here." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.data.data.map((n) => (
            <li key={n.id} className="flex gap-3 py-3">
              <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-teal-600')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{n.title}</p>
                {n.body && <p className="text-sm text-slate-600">{n.body}</p>}
                <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(n.created_at)}</p>
              </div>
              {!n.read_at && (
                <button className="text-xs font-medium text-teal-700 hover:underline" onClick={() => markRead.mutate(n.id)}>
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
