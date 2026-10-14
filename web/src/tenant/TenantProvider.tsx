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
  branch: Branch | null;
  setBranchId: (id: number) => void;
  can: (permission: string) => boolean;
  /** Prefix a tenant-relative API path: path('/products') → '/tenants/1/products'. */
  path: (relative: string) => string;
}

const TenantContext = createContext<TenantValue | null>(null);

const storageKey = (tenantId: number) => `smartpos.branch.${tenantId}`;

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
    (id: number) => {
      setBranchIdState(id);
      try {
        localStorage.setItem(storageKey(tenantId), String(id));
      } catch {
        // Storage unavailable (private mode); the choice simply is not remembered.
      }
    },
    [tenantId],
  );

  const value = useMemo<TenantValue>(() => {
    const permissions = new Set(data.permissions);
    return {
      tenantId,
      tenant: data.tenant,
      membershipId: data.membership_id,
      permissions,
      roles: data.roles,
      branches: data.branches,
      allBranches: data.all_branches,
      branch: data.branches.find((b) => b.id === branchId) ?? data.branches[0] ?? null,
      setBranchId,
      can: (permission: string) => permissions.has(permission),
      path: (relative: string) => `/tenants/${tenantId}${relative}`,
    };
  }, [data, tenantId, branchId, setBranchId]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantValue {
  const value = useContext(TenantContext);
  if (!value) throw new Error('useTenant must be used inside TenantProvider');
  return value;
}
