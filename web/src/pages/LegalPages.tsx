import { ArrowLeft, FileText, Info } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { LEGAL_POLICIES, LegalLinks, useLegalHref } from '../components/LegalLinks';
import { platformInfo } from '../lib/platformInfo';

const demo = platformInfo.demo;
const DEMO_CONTACT = 'none (personal demo project, not monitored)';
const platformName = platformInfo.legalName || (demo ? 'Unified SmartPOS, a personal demo project (not a registered business)' : '[ADD PLATFORM LEGAL NAME]');
const platformEmail = platformInfo.privacyEmail || (demo ? DEMO_CONTACT : '[ADD PLATFORM PRIVACY EMAIL]');
const platformAddress = platformInfo.businessAddress || (demo ? 'not applicable (demo project)' : '[ADD PLATFORM BUSINESS ADDRESS]');
const supportEmail = platformInfo.supportEmail || (demo ? DEMO_CONTACT : '[ADD PLATFORM SUPPORT EMAIL]');
const retention = demo ? 'Demo data, including accounts and orders, can be reset or deleted at any time without notice.' : 'Retention period: [ADD RETENTION PERIOD].';
const serviceTerms = demo
  ? 'This is a personal demo project offered as-is, with no guaranteed availability, no fees, and no support commitments. Accounts and data may be reset at any time. Do not use it for real purchases or enter real personal data you need to keep private.'
  : 'Before launch, the operator must describe hosting, support hours, service availability, fees (if any), account termination, data export and deletion, and any service limitations here: [ADD SERVICE TERMS].';
const refundRules = demo
  ? 'Sample policy for this demo store: unopened items may be returned within 7 days with the receipt; opened food, drinks and personal-care items cannot be returned unless defective; pickup and delivery orders can be cancelled until the store confirms them, and a delivery can be refused at the door if items are wrong or damaged. Because this is a demo, no real purchases, payments or refunds take place.'
  : 'Each business must publish its own customer refund, exchange, cancellation, and return rules and provide a contact method: [BUSINESS: ADD REFUND POLICY AND CONTACT].';

type Section = { title: string; body: string[] };
type Policy = { title: string; intro: string; sections: Section[] };

const POLICIES: Record<string, Policy> = {
  privacy: {
    title: 'Privacy notice',
    intro: 'This working notice describes personal information handled by Unified SmartPOS and businesses using it. The platform owner must complete the marked operator and retention details and review this notice before production use.',
    sections: [
      { title: 'Who handles your information', body: [
        `For a shop order or job application, the business named on that page receives the information and decides how it is used for its store or hiring. Unified SmartPOS provides the software used to collect and manage it. The platform operator’s registered legal name is ${platformName} and its privacy contact is ${platformEmail}.`,
      ] },
      { title: 'Information the system handles', body: [
        'Depending on the features a business uses, this can include account names, email addresses, phone numbers, passwords (stored as password hashes), orders, purchase history, delivery addresses and map coordinates, staff profiles, audit events with IP address and browser details, and job applications and uploaded documents. Staff forms can include birth dates and emergency-contact details. Do not provide information that a form does not request.',
      ] },
      { title: 'Why it is used and who may receive it', body: [
        'Businesses use the information to operate accounts, process orders, provide customer support, manage staff, and handle recruitment. Information is available to authorized users of the relevant business according to their access. Account and verification emails are sent through the mail service configured by the operator.',
        'When someone uses address search or a map, the browser contacts OpenStreetMap tile and Nominatim services; a typed address or selected coordinates may be sent to Nominatim to find or describe a location. A link to Google Maps is provided for directions. The application code contains no analytics tracker; the deployed host may add services that are not represented here.',
      ] },
      { title: 'Storage and retention', body: [
        `Information is stored in the deployment’s database and file storage. ${retention} Privacy/deletion contact: ${platformEmail}.`,
      ] },
      { title: 'Your questions and requests', body: [
        `For information collected by a shop or employer, contact that business using its published contact details. For platform account or infrastructure questions, contact ${platformEmail}. The operator must complete these contacts and explain the process for privacy requests before launch.`,
      ] },
    ],
  },
  terms: {
    title: 'Terms of use',
    intro: 'This is a draft framework for the Unified SmartPOS application. The platform operator must add its legal identity, contact details, service and payment terms, and have the terms reviewed before accepting users.',
    sections: [
      { title: 'Operator and contact', body: [`Operator: ${platformName}. Support: ${supportEmail}. Address: ${platformAddress}.${demo ? '' : ' Add support hours before launch.'}`] },
      { title: 'Using an account', body: [
        'Keep sign-in details private, provide accurate account information, and use only the businesses and features you are authorized to access. Business owners are responsible for their staff access, business details, product information, prices, taxes, customer notices, and decisions made using their records.',
      ] },
      { title: 'Service scope', body: [
        'The application records point-of-sale activity, inventory, orders, and related business information. Recorded cash, card, GCash, Maya, and transfer tenders are not payment processing: this version does not send money to a payment account or confirm a payment with a provider. Online shop orders are currently paid in-store or cash-on-delivery as shown in the shop. This software is not represented here as BIR-accredited; each business must confirm the applicable BIR permit and software requirements before relying on it for tax invoices or receipts.',
        serviceTerms,
      ] },
      { title: 'Business and customer terms', body: [
        'Each participating business remains responsible for the terms it gives its customers, including product descriptions, prices, delivery, cancellations, refunds, and required tax documents. Contact the business shown on the shop page for an order issue.',
      ] },
    ],
  },
  cookies: {
    title: 'Cookie and browser storage notice',
    intro: 'The application uses browser storage for sign-in and to remember selected settings. The platform owner should compare this notice with the final hosting, analytics, and monitoring setup before launch.',
    sections: [
      { title: 'Cookies needed for sign-in', body: [
        'The web app uses first-party session and CSRF cookies for sign-in and to protect account changes. These support core application functions. The server controls session-cookie security settings for the deployed domain.',
      ] },
      { title: 'Local browser storage', body: [
        'The app also uses local or session storage to remember interface preferences and selected businesses, and in the shop to remember saved products and delivery-location details on that device. Clearing browser storage removes these saved preferences; it does not delete an account or an order already submitted to a business.',
      ] },
      { title: 'Maps and analytics', body: [
        'The app loads map tiles from OpenStreetMap and may send address text or coordinates to OpenStreetMap Nominatim for location search. Google Maps opens only when a user follows a directions link. No analytics tracker is included in this repository. If analytics or advertising tools are added to deployment, update this notice and configure them before enabling them.',
      ] },
    ],
  },
  refunds: {
    title: 'Refund information',
    intro: 'This application does not currently collect online payments or issue money back through a payment provider. Refund decisions for store purchases belong to the business that made the sale.',
    sections: [
      { title: 'Store purchases', body: [
        `${refundRules} Contact the store shown on the shop or receipt about a purchase. The POS has an internal refund approval window and approval threshold; those staff controls are not, by themselves, a customer refund policy.`,
      ] },
      { title: 'SmartPOS service', body: [
        'No SmartPOS subscription or online payment checkout is offered by this codebase, so there is no platform payment refund process to describe here. If the operator later charges for the service, add the applicable fee, cancellation, and refund terms before taking payment.',
      ] },
    ],
  },
};

/** Where the Back button goes: the page the reader came from (sign in, shop, careers…), only within this site. */
function backTarget(from: string | null): { to: string; label: string } {
  const safe = from && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/legal/') ? from : '/login';
  if (safe.startsWith('/shop')) return { to: safe, label: 'Back to shop' };
  if (safe.startsWith('/careers') || safe.startsWith('/applications')) return { to: safe, label: 'Back to careers' };
  if (safe.startsWith('/register')) return { to: safe, label: 'Back to sign up' };
  if (safe.startsWith('/login') || safe === '/') return { to: safe, label: 'Back to sign in' };
  return { to: safe, label: 'Back' };
}

export function LegalPage() {
  const { policy: slug } = useParams();
  const [params] = useSearchParams();
  const href = useLegalHref();
  const policy = slug ? POLICIES[slug] : undefined;
  const back = backTarget(params.get('from'));
  const current = LEGAL_POLICIES.find((p) => p.slug === slug);
  const Icon = current?.icon ?? FileText;
  // Each policy opens at the top (not at the scroll position of the page it was opened from).
  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  if (!policy) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f6f1] px-5">
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold text-slate-900">Policy not found</h1>
          <Link to={back.to} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-brand-700 px-5 text-sm font-semibold text-white"><ArrowLeft className="size-4" />{back.label}</Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6f1] text-slate-800">
      <a href="#main-content" className="sr-only z-50 rounded bg-white px-4 py-2 text-slate-900 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>

      {/* Header */}
      <header className="relative isolate overflow-hidden bg-[#062a1d] text-white">
        <span aria-hidden className="absolute -left-24 -top-32 -z-10 size-[22rem] rounded-full bg-emerald-500/35 blur-[90px]" />
        <span aria-hidden className="absolute -bottom-40 right-0 -z-10 size-[24rem] rounded-full bg-sun-400/20 blur-[100px]" />
        <div className="mx-auto max-w-4xl px-4 pb-20 pt-5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <Link to={back.to} className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 pl-3 pr-4 text-sm font-semibold ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20">
              <ArrowLeft className="size-4" /> {back.label}
            </Link>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-50/80">
              <img src="/brand/minimart-logo.svg" alt="" className="size-8 rounded-lg bg-white p-0.5" /> <span className="hidden sm:inline">Unified SmartPOS</span>
            </span>
          </div>
          <div className="mt-8 flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sun-300 to-sun-500 text-brand-900 shadow-lg"><Icon className="size-7" /></span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.18em] text-sun-300">Legal &amp; policies</p>
              <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{policy.title}</h1>
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" className="relative z-10 mx-auto -mt-12 max-w-4xl px-4 pb-14 sm:px-6">
        {/* Policy tabs */}
        <nav aria-label="Policies" className="grid grid-cols-4 gap-1 rounded-2xl bg-white p-1.5 shadow-[0_18px_40px_-26px_rgba(15,23,42,.5)] ring-1 ring-slate-900/[.06]">
          {LEGAL_POLICIES.map((p) => {
            const active = p.slug === slug;
            return (
              <Link key={p.slug} to={href(p.slug)} aria-current={active ? 'page' : undefined}
                className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition sm:flex-row sm:gap-2 sm:px-3 sm:py-2.5 sm:text-sm ${active ? 'bg-gradient-to-b from-brand-600 to-brand-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
                <p.icon className={`size-4 shrink-0 ${active ? 'text-sun-300' : 'text-slate-400'}`} /><span className="truncate">{p.label}</span>
              </Link>
            );
          })}
        </nav>

        <article className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[.06] sm:p-9">
          {demo
            ? <p className="flex gap-3 rounded-2xl bg-sky-50 p-4 text-sm leading-6 text-sky-950 ring-1 ring-sky-200"><Info className="mt-0.5 size-5 shrink-0 text-sky-600" /><span><strong>Personal demo project.</strong> Unified SmartPOS and the stores shown in it are a demo, not a real business. No real orders, payments or deliveries happen, and data may be reset at any time. Please do not enter real personal information you need to keep private.</span></p>
            : <p className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-950 ring-1 ring-amber-200"><Info className="mt-0.5 size-5 shrink-0 text-amber-600" /><span><strong>Draft for completion:</strong> {policy.intro}</span></p>}

          {/* Contents */}
          <nav aria-label="On this page" className="mt-6 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-[.16em] text-slate-400">On this page</p>
            <ol className="mt-2 grid gap-1 sm:grid-cols-2">
              {policy.sections.map((section, i) => (
                <li key={section.title}><a href={`#section-${i + 1}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 transition hover:bg-white hover:text-brand-800">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white text-[11px] font-bold text-brand-700 ring-1 ring-slate-200">{i + 1}</span>{section.title}
                </a></li>
              ))}
            </ol>
          </nav>

          <div className="mt-8 space-y-8">
            {policy.sections.map((section, i) => (
              <section key={section.title} id={`section-${i + 1}`} className="scroll-mt-6">
                <h2 className="flex items-center gap-3 font-display text-xl font-bold text-slate-900">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-sm font-extrabold text-brand-700 ring-1 ring-brand-100">{i + 1}</span>{section.title}
                </h2>
                {section.body.map((paragraph) => <p key={paragraph} className="mt-3 text-[15px] leading-7 text-slate-600 sm:pl-11">{paragraph}</p>)}
              </section>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-4 border-t border-slate-100 pt-6 sm:flex-row sm:justify-between">
            <Link to={back.to} className="inline-flex h-11 items-center gap-2 rounded-full bg-brand-700 px-5 text-sm font-semibold text-white shadow-md shadow-brand-900/20 transition hover:bg-brand-800">
              <ArrowLeft className="size-4" /> {back.label}
            </Link>
            <LegalLinks />
          </div>
        </article>
      </main>
    </div>
  );
}
