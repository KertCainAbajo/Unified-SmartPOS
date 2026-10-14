<?php

namespace App\Services\Staff;

use App\Models\TenantMembership;

/**
 * Next employee ID in the business, e.g. EMP-0001, EMP-0002. Codes typed by administrators in other formats
 * are left alone; uniqueness is guaranteed by the (tenant_id, employee_code) index.
 */
class EmployeeCodeGenerator
{
    private const PREFIX = 'EMP-';

    public function next(int $tenantId): string
    {
        $highest = TenantMembership::query()
            ->where('tenant_id', $tenantId)
            ->where('employee_code', 'like', self::PREFIX.'%')
            ->pluck('employee_code')
            ->map(fn (string $code) => ctype_digit(substr($code, strlen(self::PREFIX))) ? (int) substr($code, strlen(self::PREFIX)) : 0)
            ->max() ?? 0;

        return self::PREFIX.str_pad((string) ($highest + 1), 4, '0', STR_PAD_LEFT);
    }
}
