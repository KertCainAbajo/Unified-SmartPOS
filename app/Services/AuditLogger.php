<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

/** Writes append-only audit entries. Sensitive attributes are always stripped. */
class AuditLogger
{
    private const REDACTED_KEYS = ['password', 'remember_token', 'token', 'current_password', 'password_confirmation'];

    public function __construct(
        private readonly TenantContext $context,
        private readonly Request $request,
    ) {}

    /**
     * @param  array<string, mixed>|null  $old
     * @param  array<string, mixed>|null  $new
     * @param  array<string, mixed>  $metadata
     */
    public function log(
        string $action,
        ?Model $subject = null,
        ?array $old = null,
        ?array $new = null,
        array $metadata = [],
        ?int $tenantId = null,
        ?int $branchId = null,
        ?int $userId = null,
    ): AuditLog {
        return AuditLog::query()->create([
            'tenant_id' => $tenantId ?? ($this->context->hasTenant() ? $this->context->tenantId() : null),
            'user_id' => $userId ?? $this->request->user()?->id,
            'branch_id' => $branchId ?? ($subject?->getAttributes()['branch_id'] ?? null),
            'action' => $action,
            'auditable_type' => $subject ? $subject->getMorphClass() : null,
            'auditable_id' => $subject?->getKey(),
            'old_values' => $old === null ? null : $this->clean($old),
            'new_values' => $new === null ? null : $this->clean($new),
            'metadata' => $metadata === [] ? null : $this->clean($metadata),
            'ip_address' => $this->request->ip(),
            'user_agent' => mb_substr((string) $this->request->userAgent(), 0, 512) ?: null,
        ]);
    }

    /** Log only the attributes that changed on a model that was just updated. */
    public function logChanges(string $action, Model $model, array $original, array $metadata = []): ?AuditLog
    {
        $changes = $model->getChanges();
        unset($changes['updated_at']);

        if ($changes === []) {
            return null;
        }

        $old = array_intersect_key($original, $changes);

        return $this->log($action, $model, $old, $changes, $metadata);
    }

    private function clean(array $values): array
    {
        foreach ($values as $key => $value) {
            if (in_array($key, self::REDACTED_KEYS, true)) {
                unset($values[$key]);
            } elseif ($value instanceof \BackedEnum) {
                $values[$key] = $value->value;
            } elseif ($value instanceof \DateTimeInterface) {
                $values[$key] = $value->format(DATE_ATOM);
            }
        }

        return $values;
    }
}
