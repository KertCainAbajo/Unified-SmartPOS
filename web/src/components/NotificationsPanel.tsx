import { Bell, BellOff, Bike, Briefcase, CheckCheck, KeyRound, PackageX, RotateCcw, ShoppingBag, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTenantMutation, useTenantQuery } from '../lib/hooks';
import { formatDateTime } from '../lib/format';
import type { AppNotification, Paginated } from '../lib/types';
import { Button, Modal, Spinner, cx } from './ui';

/** Icon and colour by notification type (matched on the start of the type). */
const KINDS: { match: RegExp; icon: LucideIcon; tone: string; label: string }[] = [
  { match: /^online_order/, icon: ShoppingBag, tone: 'bg-emerald-100 text-emerald-700', label: 'Online order' },
  { match: /^delivery/, icon: Bike, tone: 'bg-sky-100 text-sky-700', label: 'Delivery' },
  { match: /^refund/, icon: RotateCcw, tone: 'bg-rose-100 text-rose-700', label: 'Refund' },
  { match: /stock|inventory/, icon: PackageX, tone: 'bg-amber-100 text-amber-700', label: 'Stock' },
  { match: /interview|recruit|application|vacancy/, icon: Briefcase, tone: 'bg-violet-100 text-violet-700', label: 'Hiring' },
  { match: /staff|password|recovery/, icon: KeyRound, tone: 'bg-indigo-100 text-indigo-700', label: 'Account' },
];
const kindOf = (type: string) => KINDS.find((k) => k.match.test(type)) ?? { icon: Bell, tone: 'bg-slate-100 text-slate-600', label: 'Notice' };

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'Yesterday';
  return formatDateTime(iso);
}

export function NotificationsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const list = useTenantQuery<Paginated<AppNotification>>('/notifications', { per_page: 30 }, { enabled: open });
  const readAll = useTenantMutation<void>('POST', '/notifications/read-all');
  const markRead = useTenantMutation<number>('POST', (id) => `/notifications/${id}/read`, { toastErrors: false });

  const all = list.data?.data ?? [];
  const unread = all.filter((n) => !n.read_at).length;
  const shown = filter === 'unread' ? all.filter((n) => !n.read_at) : all;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const groups = [
    { label: 'Today', items: shown.filter((n) => new Date(n.created_at).getTime() >= startOfToday) },
    { label: 'Earlier', items: shown.filter((n) => new Date(n.created_at).getTime() < startOfToday) },
  ].filter((g) => g.items.length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Notifications"
      icon={Bell}
      description={unread > 0 ? `${unread} unread` : 'You are all caught up'}
      footer={
        <Button variant="secondary" size="sm" icon={<CheckCheck className="size-4" />} loading={readAll.isPending} disabled={unread === 0} onClick={() => readAll.mutate()}>
          Mark all as read
        </Button>
      }
    >
      <div className="-mt-1 mb-4 inline-flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Show">
        {(['all', 'unread'] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={cx('rounded-lg px-3 py-1.5 text-xs font-semibold transition duration-200', filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
            {f === 'all' ? 'All' : 'Unread'}{f === 'unread' && unread > 0 && <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-px text-[10px] text-white">{unread}</span>}
          </button>
        ))}
      </div>

      {list.isPending ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div className="sp-rise flex flex-col items-center py-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><BellOff className="size-6" /></span>
          <p className="mt-3 font-display font-semibold text-slate-900">{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</p>
          <p className="mt-1 max-w-xs text-sm text-slate-500">New online orders, deliveries, low-stock alerts and refund approvals appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.label}>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{g.label}</p>
              <ul className="space-y-1.5">
                {g.items.map((n, i) => {
                  const kind = kindOf(n.type);
                  return (
                    <li key={n.id} className="sp-rise" style={{ animationDelay: `${Math.min(i * 35, 280)}ms` }}>
                      <button type="button" onClick={() => !n.read_at && markRead.mutate(n.id)}
                        className={cx('group relative flex w-full gap-3 rounded-2xl p-3 text-left transition duration-200', n.read_at ? 'hover:bg-slate-50' : 'bg-brand-50/60 ring-1 ring-brand-100 hover:bg-brand-50')}>
                        <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', kind.tone)}><kind.icon className="size-5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className={cx('text-sm', n.read_at ? 'font-medium text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</span>
                            <span className="shrink-0 text-[11px] text-slate-400" title={formatDateTime(n.created_at)}>{timeAgo(n.created_at)}</span>
                          </span>
                          {n.body && <span className="mt-0.5 block text-[13px] leading-snug text-slate-600">{n.body}</span>}
                          <span className="mt-1.5 flex items-center gap-2 text-[11px]">
                            <span className="font-semibold uppercase tracking-wider text-slate-400">{kind.label}</span>
                            {!n.read_at && <span className="font-semibold text-brand-700 opacity-0 transition group-hover:opacity-100">Mark as read</span>}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
