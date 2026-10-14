import { Boxes, ScanBarcode, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandLogo } from '../../components/BrandLogo';

const FEATURES = [
  { icon: <ScanBarcode className="size-5" />, title: 'Fast checkout', text: 'Scan, discount and take any payment in seconds.' },
  { icon: <Boxes className="size-5" />, title: 'Live stock', text: 'Inventory, transfers and purchasing across every branch.' },
  { icon: <ShieldCheck className="size-5" />, title: 'Secure team access', text: 'Roles, branch limits and a full audit trail.' },
];

/**
 * Sign-in pages as one floating card: brand panel (desktop) joined to the form, centred on a soft background.
 * `below` renders under the form inside the card (secondary links); `panel` replaces the brand panel's message and
 * highlights (the login page tailors it to who is signing in). On small screens the logo tops the card.
 */
export function AuthLayout({ title, subtitle, children, footer, below, panel }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  below?: ReactNode;
  panel?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-cream via-[#f4f6ef] to-brand-100/70 px-3 py-6 sm:px-6 lg:py-8">
      {/* Background decoration behind the card. */}
      <div className="pointer-events-none absolute -left-40 -top-40 size-[32rem] rounded-full bg-sun-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -right-32 size-[36rem] rounded-full bg-brand-300/30 blur-3xl" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{ backgroundImage: 'radial-gradient(#1c644014 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      />

      <div className="relative grid w-full max-w-6xl grid-cols-1 overflow-hidden rounded-[2rem] bg-white shadow-[0_30px_80px_-20px_rgba(14,49,33,0.35)] ring-1 ring-brand-900/10 lg:min-h-[min(52rem,calc(100vh-4rem))] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <BrandPanel>{panel}</BrandPanel>

        <main className="flex min-w-0 flex-col justify-center px-5 py-8 sm:px-10 lg:px-14 lg:py-10">
          <div className="mx-auto w-full max-w-[25rem]">
            <div className="mx-auto mb-6 w-32 rounded-2xl bg-cream p-3 ring-1 ring-brand-900/5 lg:hidden">
              <BrandLogo />
            </div>

            <header key={title} className="auth-fade mb-6">
              <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight text-brand-900">{title}</h1>
              {subtitle && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-slate-500">{subtitle}</p>}
            </header>

            {children}

            {below && <div className="mt-6 space-y-3">{below}</div>}
            {footer && <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>}
          </div>
        </main>
      </div>

    </div>
  );
}

function BrandPanel({ children }: { children?: ReactNode }) {
  return (
    <aside className="relative hidden overflow-hidden bg-brand-900 text-white lg:flex lg:flex-col">
      {/* Layered background: deep green gradient, a warm "sunrise" glow and soft rays echoing the logo. */}
      <div className="absolute inset-0 bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900" />
      <div className="absolute -top-48 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-sun-400/20 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: 'repeating-conic-gradient(from 0deg at 50% -10%, #fff 0deg 1.5deg, transparent 1.5deg 10deg)',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%, #000 30%, transparent 75%)',
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-brand-900 to-transparent" />

      <div className="relative z-10 flex h-full flex-col px-10 py-9 xl:px-12">
        <div className="flex items-center gap-2 text-sm font-medium text-brand-100">
          <span className="size-2 rounded-full bg-sun-400 shadow-[0_0_12px_2px] shadow-sun-400/70" />
          Unified SmartPOS
        </div>

        <div className="flex min-h-0 flex-1 flex-col justify-center py-6">
          {children ?? <DefaultMessage />}
        </div>

        <p className="text-xs text-brand-100/50">Every sign-in is recorded in the audit trail for your protection.</p>
      </div>
    </aside>
  );
}

/** Logo card used at the top of every brand panel. */
export function PanelLogo() {
  return (
    <div className="w-full max-w-[13.5rem] rounded-[1.5rem] bg-cream p-4 shadow-2xl shadow-black/30 ring-1 ring-white/20 xl:max-w-[15rem]">
      <BrandLogo />
    </div>
  );
}

/** One highlight row in the brand panel. */
export function PanelFeature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex items-center gap-3.5 rounded-2xl bg-white/[0.06] px-4 py-2.5 ring-1 ring-white/10 backdrop-blur-sm">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sun-400/15 text-sun-300 ring-1 ring-sun-400/30 [&>svg]:size-5">{icon}</span>
      <span>
        <span className="block text-[0.95rem] font-semibold">{title}</span>
        <span className="block text-[0.8rem] text-brand-100/70">{text}</span>
      </span>
    </li>
  );
}

function DefaultMessage() {
  return (
    <div className="auth-fade">
      <PanelLogo />
      <h2 className="mt-7 max-w-md font-display text-[1.95rem] font-bold leading-[1.15] tracking-tight xl:text-[2.2rem]">
        Run your store with <span className="text-sun-400">confidence</span>.
      </h2>
      <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-brand-100/80">
        Point of sale, inventory, purchasing and your whole team — one system, every branch.
      </p>
      <ul className="mt-7 grid max-w-md gap-2.5">
        {FEATURES.map((f) => <PanelFeature key={f.title} {...f} />)}
      </ul>
    </div>
  );
}
