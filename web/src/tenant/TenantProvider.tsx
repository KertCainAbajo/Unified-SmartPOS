import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { setDeviceBusiness } from '../lib/device';
import type { Branch, Tenant, TenantContextData } from '../lib/types';

interface TenantValue {
  /** This member's id in the business (e.g. to recognise interviews assigned to me). */
  membershipId: number;
  tenantId: number;
  tenant: Tenant;
  permissions: Set<string>;
  roles: string[];
  branches: Branch[];
  allBranches: boolean;
  /** The branch you work in (POS, stock adjustments, new records). Always a real branch. */
  branch: Branch | null;
  /** True when the branch switcher is on "All branches": lists show every authorized branch. */
  viewAll: boolean;
  /** Branch id to filter lists by, or undefined for all authorized branches. */
  scopeBranchId: number | undefined;
  /** Pick a branch, or 'all' to view every authorized branch at once. */
  setBranchId: (id: number | 'all') => void;
  /** Display name of a branch id (null = business-wide). */
  branchName: (id: number | null | undefined) => string;
  can: (permission: string) => boolean;
  /** Prefix a tenant-relative API path: path('/products') → '/tenants/1/products'. */
  path: (relative: string) => string;
}

const TenantContext = createContext<TenantValue | null>(null);

const storageKey = (tenantId: number) => `smartpos.branch.${tenantId}`;
const viewAllKey = (tenantId: number) => `smartpos.branch-view-all.${tenantId}`;

function readViewAll(tenantId: number): boolean {
  try {
    return localStorage.getItem(viewAllKey(tenantId)) === '1';
  } catch {
    return false;
  }
}

function readStoredBranch(tenantId: number): number | null {
  try {
    const raw = localStorage.getItem(storageKey(tenantId));
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Loads the caller's context in a business (permissions + authorized branches).
 * The UI uses it to hide what the user cannot do; the API still enforces every permission.
 */
export function useTenantContextQuery(tenantId: number) {
  return useQuery({
    queryKey: ['tenant-context', tenantId],
    queryFn: () => api<TenantContextData>(`/tenants/${tenantId}/context`),
    enabled: Number.isFinite(tenantId) && tenantId > 0,
    retry: false,
    staleTime: 60_000,
  });
}

export function TenantProvider({ data, tenantId, children }: { data: TenantContextData; tenantId: number; children: ReactNode }) {
  const [branchId, setBranchIdState] = useState<number | null>(() => readStoredBranch(tenantId));
  const [viewAllState, setViewAll] = useState(() => readViewAll(tenantId));

  // This device now belongs to this business: staff here sign in with just username / employee ID.
  useEffect(() => {
    setDeviceBusiness({ code: data.tenant.slug, name: data.tenant.name });
  }, [data.tenant.slug, data.tenant.name]);

  // Fall back to the first authorized branch when nothing (or something stale) is stored.
  useEffect(() => {
    if (!data.branches.some((b) => b.id === branchId)) {
      setBranchIdState(data.branches[0]?.id ?? null);
    }
  }, [data.branches, branchId]);

  const setBranchId = useCallback(
    (id: number | 'all') => {
      setViewAll(id === 'all');
      if (id !== 'all') setBranchIdState(id);
      try {
        localStorage.setItem(viewAllKey(tenantId), id === 'all' ? '1' : '0');
        if (id !== 'all') localStorage.setItem(storageKey(tenantId), String(id));
      } catch {
        // Storage unavailable (private mode); the choice simply is not remembered.
      }
    },
    [tenantId],
  );

  const value = useMemo<TenantValue>(() => {
    const permissions = new Set(data.permissions);
    // Inactive branches stay in history (names on old sales, reports) but cannot be picked to work in.
    const active = data.branches.filter((b) => b.is_active);
    const branch = active.find((b) => b.id === branchId) ?? active[0] ?? null;
    // "All branches" only makes sense when there is more than one to look at.
    const viewAll = viewAllState && active.length > 1;
    return {
      tenantId,
      tenant: data.tenant,
      membershipId: data.membership_id,
      permissions,
      roles: data.roles,
      branches: active,
      allBranches: data.all_branches,
      branch,
      viewAll,
      scopeBranchId: viewAll ? undefined : branch?.id,
      setBranchId,
      branchName: (id) => (id === null || id === undefined ? 'Business-wide' : data.branches.find((b) => b.id === id)?.name ?? `Branch #${id}`),
      can: (permission: string) => permissions.has(permission),
      path: (relative: string) => `/tenants/${tenantId}${relative}`,
    };
  }, [data, tenantId, branchId, viewAllState, setBranchId]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantValue {
  const value = useContext(TenantContext);
  if (!value) throw new Error('useTenant must be used inside TenantProvider');
  return value;
}
