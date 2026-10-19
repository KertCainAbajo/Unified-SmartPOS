import {
  ArrowRight,
  BarChart3,
  Boxes,
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  IdCard,
  KeyRound,
  Loader2,
  Mail,
  Receipt,
  ScanBarcode,
  ShieldCheck,
  Store,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth, type LoginCredentials } from '../../auth/AuthProvider';
import { ErrorBanner } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { getDeviceBusiness, setDeviceBusiness, type DeviceBusiness } from '../../lib/device';
import { AuthLayout, PanelFeature, PanelLogo } from './AuthLayout';

type Mode = 'staff' | 'email';

/**
 * Two kinds of people sign in here, and the page adapts to each:
 *  - Staff (cashiers, stock clerks, crew): username or employee ID + password; the business comes from this device.
 *  - Management (owners, managers, HR, platform admins): email + password (the API refuses username sign-in for them).
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [device, setDevice] = useState(getDeviceBusiness);
  // Staff are the everyday users of the sign-in page.
  const [mode, setMode] = useState<Mode>('staff');
  const [email, setEmail] = useState('');
  const [businessCode, setBusinessCode] = useState('');
  const [codeEntry, setCodeEntry] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const staff = mode === 'staff';

  // Usernames are per store, so a new device needs to know its store. Branches are not chosen here: the owner or
  // manager assigns each employee's branch, and the app opens on it after sign-in.
  const directory = useQuery({
    queryKey: ['sign-in-directory'],
    queryFn: () => api<{ data: DirectoryStore[] }>('/auth/businesses'),
    enabled: staff && !device,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const stores = directory.data?.data ?? [];
  const chooseStore = (business: DeviceBusiness) => {
    setDeviceBusiness(business);
    setDevice(business);
  };
  // A single store on this system: use it without asking.
  useEffect(() => {
    if (!device && stores.length === 1) chooseStore({ code: stores[0].code, name: stores[0].name });
  }, [device, stores]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const code = device?.code ?? businessCode.trim().toLowerCase();
    const credentials: LoginCredentials = staff ? { business_code: code, username: username.trim(), password } : { email, password };
    try {
      await login(credentials);
      // Remember the store; its real name replaces the code once the business is opened.
      if (staff && !device) setDeviceBusiness({ code, name: code });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fieldError = error instanceof ApiError ? error.field(staff ? 'username' : 'email') : undefined;
  const ready = password !== '' && (staff ? username.trim() !== '' && (device !== null || businessCode.trim() !== '') : email.trim() !== '');
  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));
  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setPassword('');
  };
  const showStoreList = !device && !codeEntry && stores.length > 1;
  const showCodeField = !device && !showStoreList && !directory.isPending;

  return (
    <AuthLayout
      title={staff ? 'Start your shift' : 'Welcome back'}
      subtitle={staff ? 'Sign in with your username or employee ID.' : 'Owners, managers and HR sign in with their work email.'}
      panel={staff ? <StaffPanel device={device} /> : <ManagementPanel />}
      below={<Below device={device} />}
    >
      <RolePicker mode={mode} onChange={switchTo} />

      <form key={mode} onSubmit={submit} className="auth-fade mt-5 space-y-4" noValidate>
        {error && !fieldError ? <ErrorBanner error={error} /> : null}

        {staff ? (
          <>
            {showStoreList && <StoreSelect stores={stores} onPick={chooseStore} onEnterCode={() => setCodeEntry(true)} />}
            {showCodeField && (
              <div>
                <IconField id="business" label="Which store? (business code)" icon={<Building2 />} hint="Needed only the first time on this device. Ask your manager for it.">
                  {(cls) => <input id="business" autoCapitalize="none" placeholder="e.g. aling-nena-mini-mart" className={cls} value={businessCode} onChange={(e) => setBusinessCode(e.target.value)} />}
                </IconField>
                {stores.length > 1 && (
                  <button type="button" onClick={() => setCodeEntry(false)} className="mt-2 text-xs font-semibold text-brand-700 hover:text-brand-600">‹ Choose your store from the list</button>
                )}
              </div>
            )}
            <IconField id="username" label="Username or employee ID" icon={<IdCard />} error={fieldError}>
              {(cls) => <input id="username" autoComplete="username" autoCapitalize="none" placeholder="e.g. cashier.main01 or EMP-0102" className={cls} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />}
            </IconField>
          </>
        ) : (
          <IconField id="email" label="Work email" icon={<Mail />} error={fieldError}>
            {(cls) => <input id="email" type="email" autoComplete="username" placeholder="you@business.com" className={cls} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
          </IconField>
        )}

        <IconField
          id="password"
          label="Password"
          icon={<KeyRound />}
          hint={staff ? 'Forgot your password? Ask your manager to reset it.' : undefined}
          trailing={
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
        >
          {(cls) => (
            <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" className={cls}
              value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={trackCaps} onKeyDown={trackCaps} onBlur={() => setCapsLock(false)} />
          )}
        </IconField>
        {capsLock && <p className="-mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700"><TriangleAlert className="size-3.5" /> Caps Lock is on</p>}
        {!staff && <p className="-mt-2 text-right"><Link to="/forgot-password" className="text-xs font-semibold text-brand-700 hover:text-brand-600 hover:underline">Forgot password?</Link></p>}

        <button
          type="submit"
          disabled={busy || !ready}
          className="group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-b from-brand-500 to-brand-700 font-semibold text-white shadow-lg shadow-brand-700/25 ring-1 ring-brand-800/20 transition hover:to-brand-600 hover:shadow-brand-700/35 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
        >
          <span className="absolute inset-x-0 top-0 h-px bg-white/30" />
          {busy ? <Loader2 className="size-5 animate-spin" /> : <>Sign in <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></>}
        </button>
      </form>
    </AuthLayout>
  );
}

/* --------------------------------------------------------------------------- Role picker */

function RolePicker({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const card = (value: Mode, icon: ReactNode, title: string, text: string) => {
    const active = mode === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => onChange(value)}
        className={`relative flex min-w-0 flex-1 items-center gap-3 rounded-2xl border p-3 text-left transition ${
          active ? 'border-brand-500 bg-brand-50/70 shadow-sm ring-4 ring-brand-100' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl transition [&>svg]:size-5 ${active ? 'bg-brand-600 text-white shadow-md shadow-brand-700/30' : 'bg-slate-100 text-slate-500'}`}>{icon}</span>
        <span className="min-w-0">
          <span className={`block text-sm font-semibold ${active ? 'text-brand-900' : 'text-slate-700'}`}>{title}</span>
          <span className="block text-xs leading-snug text-slate-500">{text}</span>
        </span>
        {active && <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-brand-600 text-white ring-2 ring-white"><Check className="size-3" strokeWidth={3} /></span>}
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label="Who is signing in?" className="flex gap-3">
      {card('staff', <UserRound />, 'Staff', 'Cashier, stock clerk & crew')}
      {card('email', <Briefcase />, 'Management', 'Owner, manager & HR')}
    </div>
  );
}

/* --------------------------------------------------------------------------- Store dropdown */

interface DirectoryStore {
  code: string;
  name: string;
}

/** New devices on a system with several stores: pick the store once (branches are assigned by management). */
function StoreSelect({ stores, onPick, onEnterCode }: { stores: DirectoryStore[]; onPick: (store: DeviceBusiness) => void; onEnterCode: () => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor="store" className="text-sm font-medium text-slate-700">Your store</label>
        <button type="button" onClick={onEnterCode} className="text-xs font-semibold text-brand-700 hover:text-brand-600">Enter a business code instead</button>
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-600"><Store className="size-[1.125rem]" /></span>
        <select
          id="store"
          value=""
          onChange={(e) => {
            const store = stores.find((st) => st.code === e.target.value);
            if (store) onPick({ code: store.code, name: store.name });
          }}
          className="h-12 w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white pl-11 pr-10 text-[0.95rem] font-medium text-slate-400 shadow-sm outline-none transition hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        >
          <option value="" disabled>Choose the store you work at</option>
          {stores.map((st) => <option key={st.code} value={st.code} className="text-slate-900">{st.name}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">Needed only once — this device remembers it.</p>
    </div>
  );
}

/* --------------------------------------------------------------------------- Under the form */

function Below({ device }: { device: DeviceBusiness | null }) {
  return (
    <>
      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> Not part of the team yet? <span className="h-px flex-1 bg-slate-200" />
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-sun-400/40 bg-gradient-to-r from-cream/70 to-white p-3 pr-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sun-400/20 text-sun-500"><Briefcase className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-900">Looking for a job?</p>
          <p className="truncate text-xs text-slate-500">{device ? `Open positions at ${device.name}` : 'See open positions and apply online'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs font-semibold sm:flex-row sm:items-center sm:gap-3">
          <Link to={device ? `/careers/${encodeURIComponent(device.code)}` : '/careers'} className="inline-flex items-center gap-0.5 text-brand-700 hover:text-brand-600">
            Apply <ChevronRight className="size-3.5" />
          </Link>
          <Link to="/applications/status" className="text-slate-500 hover:text-brand-700">My application</Link>
        </div>
      </div>

    </>
  );
}

/* --------------------------------------------------------------------------- Brand panel per role */

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function StaffPanel({ device }: { device: DeviceBusiness | null }) {
  const now = useClock();
  return (
    <div key="staff" className="auth-fade">
      <div className="flex items-end justify-between gap-6">
        <PanelLogo />
        {/* Shift clock: staff usually sign in at the start of a shift. */}
        <div className="mb-1 hidden rounded-2xl bg-white/[0.07] px-4 py-3 text-right ring-1 ring-white/10 backdrop-blur-sm xl:block">
          <p className="flex items-center justify-end gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-100/70"><Clock3 className="size-3.5" /> Now</p>
          <p className="font-display text-3xl font-bold tabular-nums">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
          <p className="text-xs text-brand-100/70">{now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</p>
        </div>
      </div>

      <p className="mt-7 inline-flex items-center gap-2 rounded-full bg-sun-400/15 px-3 py-1 text-xs font-semibold text-sun-300 ring-1 ring-sun-400/30">
        <span className="size-1.5 rounded-full bg-sun-400" /> Staff sign-in{device ? ` · ${device.name}` : ''}
      </p>
      <h2 className="mt-3 max-w-md font-display text-[1.95rem] font-bold leading-[1.15] tracking-tight xl:text-[2.2rem]">
        Ready for your <span className="text-sun-400">shift</span>?
      </h2>
      <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-brand-100/80">Sign in to open your register and serve customers.</p>

      <ul className="mt-6 grid max-w-md gap-2.5">
        <PanelFeature icon={<Clock3 />} title="Open your register" text="Count your starting cash and you're ready to sell." />
        <PanelFeature icon={<ScanBarcode />} title="Scan & sell fast" text="Barcodes, discounts, cash, card, GCash and Maya." />
        <PanelFeature icon={<Receipt />} title="Your sales, your receipts" text="Reprint receipts and close your shift with a clean count." />
      </ul>
    </div>
  );
}

function ManagementPanel() {
  return (
    <div key="management" className="auth-fade">
      <div className="flex items-end justify-between gap-6">
        <PanelLogo />
        {/* Decorative dashboard preview (illustration only, no real figures). */}
        <div aria-hidden="true" className="mb-1 hidden w-44 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10 backdrop-blur-sm xl:block">
          <div className="mb-2 flex items-center justify-between">
            <span className="h-1.5 w-14 rounded-full bg-white/30" />
            <BarChart3 className="size-3.5 text-sun-300" />
          </div>
          <div className="flex h-16 items-end gap-1.5">
            {[38, 55, 46, 70, 62, 84, 76].map((h, i) => (
              <span key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-sun-500/60 to-sun-300" style={{ height: `${h}%`, opacity: 0.55 + i * 0.06 }} />
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            <span className="h-1.5 flex-1 rounded-full bg-white/20" />
            <span className="h-1.5 w-8 rounded-full bg-sun-400/60" />
          </div>
        </div>
      </div>

      <p className="mt-7 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-brand-50 ring-1 ring-white/20">
        <ShieldCheck className="size-3.5 text-sun-300" /> Management console
      </p>
      <h2 className="mt-3 max-w-md font-display text-[1.95rem] font-bold leading-[1.15] tracking-tight xl:text-[2.2rem]">
        Your business, <span className="whitespace-nowrap text-sun-400">at a glance</span>.
      </h2>
      <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-brand-100/80">Sales, stock, purchasing, people and hiring — across every branch.</p>

      <ul className="mt-6 grid max-w-md gap-2.5">
        <PanelFeature icon={<BarChart3 />} title="Reports & profit" text="Daily sales, best sellers, expenses and margins." />
        <PanelFeature icon={<Users />} title="Team & hiring" text="Staff accounts, roles, interviews and onboarding." />
        <PanelFeature icon={<Boxes />} title="Stock & purchasing" text="Inventory, transfers, counts and supplier orders." />
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------------------- Input */

/** Large input with a leading icon, optional trailing control, hint and error. */
function IconField({ id, label, icon, trailing, hint, error, children }: {
  id: string;
  label: string;
  icon: ReactNode;
  trailing?: ReactNode;
  hint?: string;
  error?: string;
  children: (inputClass: string) => ReactNode;
}) {
  const inputClass = `h-12 w-full rounded-xl border bg-white pl-11 ${trailing ? 'pr-12' : 'pr-4'} text-[0.95rem] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-4 ${
    error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-slate-200 hover:border-slate-300 focus:border-brand-500 focus:ring-brand-100'
  }`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 [&>svg]:size-[1.125rem]">{icon}</span>
        {children(inputClass)}
        {trailing && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>}
      </div>
      {error ? <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p> : hint ? <p className="mt-1.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
