import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="mx-auto mt-24 max-w-md px-4 text-center">
      <p className="text-sm font-semibold text-teal-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
      <Link to="/" className="mt-6 inline-block text-sm font-medium text-teal-700 hover:underline">
        Go home
      </Link>
    </div>
  );
}

/** Shown inside the app when the member lacks the permission a page needs. */
export function NoAccess({ what = 'this page' }: { what?: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-lg font-semibold text-slate-900">No access</h1>
      <p className="mt-2 text-sm text-slate-500">Your role does not include access to {what}. Ask the business owner if you need it.</p>
    </div>
  );
}
