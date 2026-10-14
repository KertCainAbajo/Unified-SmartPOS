import { Check } from 'lucide-react';
import { HIRING_STEPS } from '../lib/recruitment';

/** Horizontal progress through the six hiring steps. `current` null = closed (rejected / withdrawn). */
export function HiringSteps({ current, closedLabel }: { current: number | null; closedLabel?: string }) {
  return (
    <div>
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {HIRING_STEPS.map((s) => {
          const done = current !== null && s.step < current;
          const active = current === s.step;
          return (
            <li
              key={s.step}
              className={`rounded-lg border px-2 py-2 text-center ${
                active ? 'border-teal-600 bg-teal-50' : done ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'
              }`}
            >
              <span
                className={`mx-auto mb-1 grid size-6 place-items-center rounded-full text-xs font-semibold ${
                  active ? 'bg-teal-700 text-white' : done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {done ? <Check className="size-3.5" /> : s.step}
              </span>
              <span className={`block text-xs font-medium ${active ? 'text-teal-900' : 'text-slate-700'}`}>{s.label}</span>
              <span className="hidden text-[11px] text-slate-500 sm:block">{s.detail}</span>
            </li>
          );
        })}
      </ol>
      {current === null && closedLabel && <p className="mt-2 text-sm font-medium text-slate-600">{closedLabel}</p>}
    </div>
  );
}
