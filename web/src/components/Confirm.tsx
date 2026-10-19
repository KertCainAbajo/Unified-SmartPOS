import { AlertTriangle, HelpCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, cx } from './ui';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for actions that remove or cannot be undone. */
  tone?: 'danger' | 'default';
}

type Ask = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/**
 * A styled replacement for the browser's confirm() box. `const confirm = useConfirm(); if (await confirm({...}))`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  const ask = useCallback<Ask>((options) => new Promise<boolean>((resolve) => {
    setRequest({ ...(typeof options === 'string' ? { title: options } : options), resolve });
  }), []);

  useEffect(() => {
    const dialog = ref.current;
    if (request && dialog && !dialog.open) dialog.showModal();
  }, [request]);

  const answer = (ok: boolean) => {
    request?.resolve(ok);
    ref.current?.close();
    setRequest(null);
  };

  const danger = request?.tone !== 'default';
  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <dialog ref={ref} onCancel={(e) => { e.preventDefault(); answer(false); }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl p-0 shadow-2xl shadow-brand-900/25 backdrop:bg-brand-900/40 backdrop:backdrop-blur-[2px]">
        {request && (
          <div className="p-6 text-center">
            <span className={cx('mx-auto grid size-14 place-items-center rounded-2xl ring-8', danger ? 'bg-rose-100 text-rose-600 ring-rose-50' : 'bg-brand-100 text-brand-700 ring-brand-50')}>
              <Icon className="size-7" />
            </span>
            <h2 className="mt-4 font-display text-lg font-bold text-slate-900">{request.title}</h2>
            {request.message && <div className="mt-1.5 text-sm text-slate-600">{request.message}</div>}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => answer(false)}>{request.cancelLabel ?? 'Cancel'}</Button>
              <Button variant={danger ? 'danger' : 'primary'} onClick={() => answer(true)} autoFocus>{request.confirmLabel ?? 'Yes, continue'}</Button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Ask {
  const value = useContext(ConfirmContext);
  if (!value) throw new Error('useConfirm must be used inside ConfirmProvider');
  return value;
}
