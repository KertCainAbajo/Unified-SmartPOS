<?php

namespace App\Services\Staff;

use App\Models\User;
use App\Support\Permissions;
use Illuminate\Support\Str;

/**
 * Suggests business-unique usernames such as `cashier.main01` or `inventory.mkt02`.
 * Uniqueness is finally guaranteed by the (managed_by_tenant_id, username) unique index.
 */
class UsernameGenerator
{
    public const PATTERN = '/^[a-z0-9][a-z0-9._-]{2,49}$/';

    private const PREFIXES = [
        Permissions::ROLE_CASHIER => 'cashier',
        Permissions::ROLE_INVENTORY => 'inventory',
        Permissions::ROLE_MANAGER => 'manager',
        Permissions::ROLE_ACCOUNTANT => 'accountant',
        Permissions::ROLE_PURCHASING => 'purchasing',
        Permissions::ROLE_AUDITOR => 'auditor',
        Permissions::ROLE_CUSTOMER_SERVICE => 'service',
        Permissions::ROLE_ACCESS_MANAGER => 'access',
    ];

    public function suggest(int $tenantId, ?string $roleKey, ?string $branchCode): string
    {
        $prefix = self::PREFIXES[$roleKey] ?? (Str::slug((string) $roleKey, '') ?: 'staff');
        $branch = Str::slug((string) $branchCode, '') ?: 'all';
        $base = Str::limit("{$prefix}.{$branch}", 44, '');

        $taken = User::query()
            ->where('managed_by_tenant_id', $tenantId)
            ->where('username', 'like', $base.'%')
            ->pluck('username')
            ->all();

        for ($n = 1; $n < 1000; $n++) {
            $candidate = $base.str_pad((string) $n, 2, '0', STR_PAD_LEFT);
            if (! in_array($candidate, $taken, true)) {
                return $candidate;
            }
        }

        return $base.Str::lower(Str::random(6));
    }

    public static function normalize(string $username): string
    {
        return Str::lower(trim($username));
    }
}
