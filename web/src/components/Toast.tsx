import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  tone: Tone;
  message: string;
  leaving: boolean;
}

interface ToastValue {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const DURATION: Record<Tone, number> = { success: 3500, info: 4500, warning: 6000, error: 7000 };
const LOOK: Record<Tone, { title: string; icon: LucideIcon; iconBox: string; bar: string; ring: string }> = {
  success: { title: 'Done', icon: CheckCircle2, iconBox: 'bg-emerald-500 text-white shadow-emerald-500/30', bar: 'bg-emerald-500', ring: 'ring-emerald-100' },
  error: { title: 'Something went wrong', icon: XCircle, iconBox: 'bg-rose-500 text-white shadow-rose-500/30', bar: 'bg-rose-500', ring: 'ring-rose-100' },
  warning: { title: 'Please check', icon: AlertTriangle, iconBox: 'bg-amber-400 text-amber-950 shadow-amber-400/30', bar: 'bg-amber-400', ring: 'ring-amber-100' },
  info: { title: 'For your information', icon: Info, iconBox: 'bg-sky-500 text-white shadow-sky-500/30', bar: 'bg-sky-500', ring: 'ring-sky-100' },
};
const MAX_VISIBLE = 4;

/**
 * Pop-up notices for every screen. They slide in at the bottom (bottom-right on wide screens), show a countdown bar,
 * pause while the pointer is over them, and slide out when dismissed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, { timer: number; started: number; remaining: number }>());

  const remove = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t.timer);
    timers.current.delete(id);
    setToasts((list) => list.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 180);
  }, []);

  const schedule = useCallback((id: number, ms: number) => {
    timers.current.set(id, { timer: window.setTimeout(() => remove(id), ms), started: Date.now(), remaining: ms });
  }, [remove]);

  const push = useCallback((tone: Tone, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => {
      // The same message twice in a row (e.g. a double click) is shown once.
      if (list.some((t) => !t.leaving && t.message === message && t.tone === tone)) return list;
      const next = [...list, { id, tone, message, leaving: false }];
      next.filter((t) => !t.leaving).slice(0, -MAX_VISIBLE).forEach((t) => window.setTimeout(() => remove(t.id), 0));
      return next;
    });
    schedule(id, DURATION[tone]);
  }, [remove, schedule]);

  const pause = (id: number) => {
    const t = timers.current.get(id);
    if (!t) return;
    window.clearTimeout(t.timer);
    timers.current.set(id, { ...t, remaining: Math.max(800, t.remaining - (Date.now() - t.started)) });
  };
  const resume = (id: number) => {
    const t = timers.current.get(id);
    if (t) schedule(id, t.remaining);
  };

  const value = useMemo(() => ({
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    warning: (m: string) => push('warning', m),
    info: (m: string) => push('info', m),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2.5 p-4 pb-24 sm:inset-x-auto md:pb-4 sm:right-0 sm:items-end print:hidden" aria-live="polite">
        {toasts.map((t) => {
          const look = LOOK[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              className={`group pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl bg-white/95 shadow-[0_18px_40px_-12px_rgba(15,23,42,0.35)] ring-1 backdrop-blur ${look.ring} ${t.leaving ? 'sp-toast-out' : 'sp-toast-in'}`}
            >
              <div className="flex items-start gap-3 p-3.5 pr-10">
                <span className={`grid size-9 shrink-0 place-items-center rounded-xl shadow-md ${look.iconBox}`}><look.icon className="size-5" /></span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-semibold text-slate-900">{look.title}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-slate-600">{t.message}</p>
                </div>
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => remove(t.id)} className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X className="size-4" />
              </button>
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-slate-100">
                <span className={`sp-progress block h-full ${look.bar} group-hover:[animation-play-state:paused]`} style={{ animationDuration: `${DURATION[t.tone]}ms` }} />
              </span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
