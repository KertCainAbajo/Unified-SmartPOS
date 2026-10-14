<?php

namespace App\Services\Staff;

use App\Enums\MembershipStatus;
use App\Enums\RefundStatus;
use App\Enums\UserStatus;
use App\Exceptions\BusinessRuleException;
use App\Models\Role;
use App\Models\StaffInvitation;
use App\Models\StaffProfile;
use App\Models\TenantMembership;
use App\Models\User;
use App\Notifications\StaffCodeNotification;
use App\Notifications\StaffInvitedToBusiness;
use App\Services\AuditLogger;
use App\Services\NotificationService;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Company-managed staff administration within the current business (TenantContext).
 * Every operation re-validates the administrator's authority on the server. See docs/STAFF_ACCOUNTS.md §5.
 */
class StaffService
{
    /** Delivery option: generate a temporary password, shown once, that must be changed at first sign-in. */
    public const DELIVERY_TEMPORARY_PASSWORD = 'temporary_password';

    public const DELIVERIES = [self::DELIVERY_TEMPORARY_PASSWORD, StaffInvitation::CHANNEL_MANUAL, StaffInvitation::CHANNEL_EMAIL];

    public function __construct(
        private readonly TenantContext $context,
        private readonly AuditLogger $audit,
        private readonly StaffCodeService $codes,
        private readonly AccessRevoker $revoker,
        private readonly UsernameGenerator $usernames,
        private readonly EmployeeCodeGenerator $employeeCodes,
        private readonly NotificationService $notifications,
    ) {}

    /* ======================================================================= Queries */

    /** Memberships the administrator may see: all for all-branch admins, otherwise those sharing a branch. */
    public function visibleMemberships(): Builder
    {
        $query = TenantMembership::query()->where('tenant_id', $this->context->tenantId());

        if (! $this->context->hasAllBranches()) {
            $branchIds = $this->context->branchIds();
            $query->where(fn (Builder $q) => $q
                ->where('user_id', $this->actorId())
                ->orWhere(fn (Builder $w) => $w->where('all_branches', false)
                    ->whereHas('branches', fn (Builder $b) => $b->whereIn('branches.id', $branchIds))));
        }

        return $query;
    }

    public function canSee(TenantMembership $target): bool
    {
        return $this->visibleMemberships()->whereKey($target->id)->exists();
    }

    /* ======================================================================= Provisioning */

    /**
     * Create a company-managed account (no personal email needed) in the `invited` state.
     *
     * @param  array{name: string, username?: string|null, email?: string|null, employee_code?: string|null,
     *               role_ids: list<int>, all_branches?: bool, branch_ids?: list<int>, delivery: string,
     *               require_password_change?: bool, profile?: array<string, mixed>}  $data
     * @return array{membership: TenantMembership, activation_code: string|null, temporary_password?: string|null, expires_at: string|null}
     */
    public function create(array $data): array
    {
        $this->authorize(Permissions::STAFF_CREATE, null, 'create');
        $roles = $this->resolveRoles($data['role_ids'], 'create');
        [$allBranches, $branchIds] = $this->resolveBranches((bool) ($data['all_branches'] ?? false), $data['branch_ids'] ?? [], 'create');

        $delivery = $data['delivery'];
        if (empty($data['email'])) {
            $this->assertEmailNotRequired($roles);
        }
        if ($delivery === StaffInvitation::CHANNEL_EMAIL && empty($data['email'])) {
            throw new BusinessRuleException('An email address is required to send an activation link.', 'EMAIL_REQUIRED',
                ['email' => ['Required when delivery is email.']]);
        }

        $tenantId = $this->context->tenantId();
        $username = isset($data['username']) && $data['username'] !== ''
            ? UsernameGenerator::normalize($data['username'])
            : $this->usernames->suggest($tenantId, $roles->first()?->key, $this->firstBranchCode($branchIds));
        $employeeCode = ($data['employee_code'] ?? '') !== '' ? $data['employee_code'] : $this->employeeCodes->next($tenantId);
        $temporary = $delivery === self::DELIVERY_TEMPORARY_PASSWORD;

        try {
            $result = DB::transaction(function () use ($data, $roles, $allBranches, $branchIds, $username, $employeeCode, $tenantId, $delivery, $temporary) {
                $user = User::query()->forceCreate([
                    'name' => $data['name'],
                    'email' => isset($data['email']) ? Str::lower(trim($data['email'])) : null,
                    'username' => $username,
                    'managed_by_tenant_id' => $tenantId,
                    // Unusable until the employee activates or the temporary password is issued below.
                    'password' => Str::random(64),
                    'status' => UserStatus::Pending->value,
                ]);

                $membership = TenantMembership::query()->create([
                    'tenant_id' => $tenantId,
                    'user_id' => $user->id,
                    'employee_code' => $employeeCode,
                    'status' => MembershipStatus::Invited->value,
                    'all_branches' => $allBranches,
                    'created_by' => $this->actorId(),
                ]);
                $membership->roles()->sync($roles->modelKeys());
                $membership->branches()->sync($branchIds);
                $profileFields = $this->saveProfile($membership, $data['profile'] ?? []);

                $this->audit->log('staff.created', $membership, null, [
                    'user_id' => $user->id,
                    'username' => $username,
                    'employee_code' => $employeeCode,
                    'roles' => $roles->pluck('key')->all(),
                    'all_branches' => $allBranches,
                    'branch_ids' => $branchIds,
                    'profile_fields' => $profileFields,
                ], tenantId: $tenantId);

                if ($temporary) {
                    return ['membership' => $membership, 'temporary' => $this->issueGeneratedPassword($membership, 'onboarding', (bool) ($data['require_password_change'] ?? false))];
                }

                ['invitation' => $invitation, 'code' => $code] = $this->codes->issue($membership, StaffInvitation::PURPOSE_ACTIVATION, $delivery, $this->actorId());
                $this->audit->log('staff.invitation_issued', $membership, null, null, [
                    'purpose' => 'activation', 'channel' => $delivery, 'expires_at' => $invitation->expires_at->toIso8601String(),
                ], tenantId: $tenantId);

                return compact('membership', 'invitation', 'code');
            });
        } catch (UniqueConstraintViolationException) {
            throw new BusinessRuleException('That username, email or employee code is already in use.', 'DUPLICATE_IDENTIFIER',
                ['username' => ['That username, email or employee code is already in use.']]);
        }

        return $temporary
            ? $this->temporaryResult($result['membership'], $result['temporary'])
            : $this->deliver($result['membership'], $result['invitation'], $result['code']);
    }

    /**
     * Invite an existing personal account by email. Always behaves the same way whether or not the email is
     * registered, so it cannot be used to discover accounts. The person must accept before gaining access.
     *
     * @param  array{email: string, role_ids: list<int>, all_branches?: bool, branch_ids?: list<int>}  $data
     */
    public function inviteExisting(array $data): void
    {
        $this->authorize(Permissions::STAFF_CREATE, null, 'invite_existing');
        $roles = $this->resolveRoles($data['role_ids'], 'invite_existing');
        [$allBranches, $branchIds] = $this->resolveBranches((bool) ($data['all_branches'] ?? false), $data['branch_ids'] ?? [], 'invite_existing');

        $tenantId = $this->context->tenantId();
        $user = User::query()->where('email', Str::lower(trim($data['email'])))->first();
        $eligible = $user
            && ! $user->isCompanyManaged()
            && $user->isActive()
            && ! TenantMembership::query()->where('tenant_id', $tenantId)->where('user_id', $user->id)->exists();

        if (! $eligible) {
            $this->audit->log('staff.invite_existing_skipped', null, null, null, ['email_hash' => hash('sha256', Str::lower(trim($data['email'])))], tenantId: $tenantId);

            return;
        }

        DB::transaction(function () use ($user, $tenantId, $allBranches, $roles, $branchIds) {
            $membership = TenantMembership::query()->create([
                'tenant_id' => $tenantId,
                'user_id' => $user->id,
                'status' => MembershipStatus::Invited->value,
                'all_branches' => $allBranches,
                'created_by' => $this->actorId(),
            ]);
            $membership->roles()->sync($roles->modelKeys());
            $membership->branches()->sync($branchIds);
            $this->audit->log('staff.existing_account_invited', $membership, null, [
                'user_id' => $user->id, 'roles' => $roles->pluck('key')->all(), 'branch_ids' => $branchIds,
            ], tenantId: $tenantId);
        });

        $user->notify(new StaffInvitedToBusiness($this->context->tenant()->name));
    }

    /* ======================================================================= Changes */

    /** @param  array{name?: string, email?: string|null, username?: string, employee_code?: string|null, profile?: array<string, mixed>}  $data */
    public function updateProfile(TenantMembership $target, array $data): TenantMembership
    {
        $this->authorize(Permissions::STAFF_UPDATE, $target, 'update_profile');
        $user = $target->user;

        $personalFields = array_intersect(array_keys($data), ['name', 'email', 'username']);
        if (! $user->isCompanyManaged() && $personalFields !== []) {
            throw new BusinessRuleException('Personal accounts manage their own name and email. Only the employee code and staff profile can be changed.',
                'PERSONAL_ACCOUNT_PROFILE', array_fill_keys($personalFields, ['Not editable for personal accounts.']));
        }

        if (array_key_exists('email', $data) && ($data['email'] ?? '') === '' && $target->requiresEmailSignIn()) {
            $this->assertEmailNotRequired($target->roles()->with('permissions')->get());
        }

        try {
            return DB::transaction(function () use ($target, $user, $data) {
                $old = ['name' => $user->name, 'email' => $user->email, 'username' => $user->username, 'employee_code' => $target->employee_code];

                if (array_key_exists('employee_code', $data)) {
                    $target->employee_code = $data['employee_code'];
                    $target->save();
                }
                foreach (['name', 'email', 'username'] as $field) {
                    if (array_key_exists($field, $data)) {
                        $value = $data[$field];
                        $user->{$field} = match ($field) {
                            'username' => UsernameGenerator::normalize($value),
                            'email' => $value === null ? null : Str::lower(trim($value)),
                            default => $value,
                        };
                    }
                }
                if ($user->isDirty('email')) {
                    $user->email_verified_at = null;
                }
                $user->save();

                $profileFields = $this->saveProfile($target, $data['profile'] ?? []);

                $new = ['name' => $user->name, 'email' => $user->email, 'username' => $user->username, 'employee_code' => $target->employee_code];
                $this->audit->log('staff.profile_updated', $target, array_diff_assoc($old, $new), array_diff_assoc($new, $old),
                    $profileFields === [] ? [] : ['profile_fields_changed' => $profileFields]);

                return $target->refresh();
            });
        } catch (UniqueConstraintViolationException) {
            throw new BusinessRuleException('That username or employee code is already used in this business.', 'DUPLICATE_IDENTIFIER');
        }
    }

    /** @param  list<int>  $roleIds */
    public function changeRoles(TenantMembership $target, array $roleIds): TenantMembership
    {
        $this->authorize(Permissions::STAFF_ASSIGN_ROLES, $target, 'change_roles');
        $roles = $this->resolveRoles($roleIds, 'change_roles', $target);
        if (! $target->user->email) {
            $this->assertEmailNotRequired($roles);
        }

        return DB::transaction(function () use ($target, $roles) {
            $old = $target->roles()->pluck('key')->all();
            $target->roles()->sync($roles->modelKeys());
            $this->audit->log('staff.roles_changed', $target, ['roles' => $old], ['roles' => $roles->pluck('key')->all()], ['user_id' => $target->user_id]);

            return $target;
        });
    }

    /** @param  list<int>  $branchIds */
    public function transferBranches(TenantMembership $target, bool $allBranches, array $branchIds): TenantMembership
    {
        $this->authorize(Permissions::STAFF_ASSIGN_BRANCHES, $target, 'transfer_branches');
        [$allBranches, $branchIds] = $this->resolveBranches($allBranches, $branchIds, 'transfer_branches', $target);

        return DB::transaction(function () use ($target, $allBranches, $branchIds) {
            $old = ['all_branches' => $target->all_branches, 'branch_ids' => $target->branchIds()];
            $target->forceFill(['all_branches' => $allBranches])->save();
            $target->branches()->sync($branchIds);
            $this->audit->log('staff.branches_changed', $target, $old, ['all_branches' => $allBranches, 'branch_ids' => $branchIds], ['user_id' => $target->user_id]);

            return $target;
        });
    }

    /* ======================================================================= Status lifecycle */

    public function suspend(TenantMembership $target, string $reason): TenantMembership
    {
        $this->authorize(Permissions::STAFF_STATUS, $target, 'suspend');
        $this->assertStatus($target, [MembershipStatus::Active, MembershipStatus::Invited], 'suspend');

        return DB::transaction(function () use ($target, $reason) {
            $old = $target->status;
            $target->forceFill(['status' => MembershipStatus::Suspended->value, 'suspended_at' => now(), 'status_reason' => $reason])->save();
            $revoked = $this->revoker->revokeAll($target->user);
            $this->audit->log('staff.suspended', $target, ['status' => $old], ['status' => 'suspended'], [
                'reason' => $reason, 'user_id' => $target->user_id, 'revoked' => $revoked,
            ]);

            return $target;
        });
    }

    /**
     * Suspended → active. Offboarded → invited (rehire) with a fresh activation code: the returning employee
     * must set a new password; their previous one no longer works.
     *
     * @return array{membership: TenantMembership, activation_code: string|null, expires_at: string|null}
     */
    public function reactivate(TenantMembership $target, string $delivery = StaffInvitation::CHANNEL_MANUAL, bool $requireChange = false): array
    {
        $this->authorize(Permissions::STAFF_STATUS, $target, 'reactivate');
        $this->assertStatus($target, [MembershipStatus::Suspended, MembershipStatus::Offboarded], 'reactivate');

        if ($target->hasStatus(MembershipStatus::Suspended)) {
            DB::transaction(function () use ($target) {
                $neverActivated = $target->user->status === UserStatus::Pending->value;
                $target->forceFill([
                    'status' => $neverActivated ? MembershipStatus::Invited->value : MembershipStatus::Active->value,
                    'suspended_at' => null,
                    'status_reason' => null,
                ])->save();
                $this->audit->log('staff.reactivated', $target, ['status' => 'suspended'], ['status' => $target->status], ['user_id' => $target->user_id]);
            });

            return ['membership' => $target, 'activation_code' => null, 'temporary_password' => null, 'expires_at' => null];
        }

        // Rehire.
        $this->authorize(Permissions::STAFF_CREDENTIALS, $target, 'rehire');
        $user = $target->user;
        if ($user->isCompanyManaged() && $delivery === StaffInvitation::CHANNEL_EMAIL && ! $user->email) {
            throw new BusinessRuleException('This account has no email address; use manual delivery.', 'EMAIL_REQUIRED');
        }

        $result = DB::transaction(function () use ($target, $user, $delivery, $requireChange) {
            $target->forceFill([
                'status' => MembershipStatus::Invited->value,
                'offboarded_at' => null,
                'offboarded_by' => null,
                'status_reason' => null,
                'joined_at' => null,
            ])->save();

            $invitation = null;
            $code = null;
            if ($user->isCompanyManaged()) {
                $user->forceFill(['status' => UserStatus::Pending->value, 'password' => Str::random(64)])->save();
                $this->audit->log('staff.rehired', $target, ['status' => 'offboarded'], ['status' => 'invited'], ['user_id' => $user->id, 'channel' => $delivery]);
                if ($delivery === self::DELIVERY_TEMPORARY_PASSWORD) {
                    return ['invitation' => null, 'code' => null, 'temporary' => $this->issueGeneratedPassword($target, 'rehire', $requireChange)];
                }
                ['invitation' => $invitation, 'code' => $code] = $this->codes->issue($target, StaffInvitation::PURPOSE_ACTIVATION, $delivery, $this->actorId());

                return compact('invitation', 'code');
            }
            $this->audit->log('staff.rehired', $target, ['status' => 'offboarded'], ['status' => 'invited'], ['user_id' => $user->id]);

            return compact('invitation', 'code');
        });

        if ($result['invitation'] === null && ! isset($result['temporary'])) {
            $user->notify(new StaffInvitedToBusiness($this->context->tenant()->name));

            return ['membership' => $target, 'activation_code' => null, 'temporary_password' => null, 'expires_at' => null];
        }
        if (isset($result['temporary'])) {
            return $this->temporaryResult($target, $result['temporary']);
        }

        return $this->deliver($target, $result['invitation'], $result['code']);
    }

    /**
     * Remove all access immediately while keeping every historical record.
     *
     * @return array{membership: TenantMembership, pending_work: array<string, mixed>}
     */
    public function offboard(TenantMembership $target, string $reason): array
    {
        $this->authorize(Permissions::STAFF_OFFBOARD, $target, 'offboard');
        $this->assertStatus($target, [MembershipStatus::Invited, MembershipStatus::Active, MembershipStatus::Suspended], 'offboard');

        $membership = DB::transaction(function () use ($target, $reason) {
            $target = TenantMembership::query()->lockForUpdate()->findOrFail($target->id);
            $user = $target->user;
            $old = $target->status;

            $target->forceFill([
                'status' => MembershipStatus::Offboarded->value,
                'offboarded_at' => now(),
                'offboarded_by' => $this->actorId(),
                'status_reason' => $reason,
            ])->save();

            // A company-managed account exists only for this business, so the login itself is disabled.
            if ($user->isCompanyManaged() && $user->managed_by_tenant_id === $target->tenant_id) {
                $user->forceFill(['status' => UserStatus::Disabled->value])->save();
            }

            $revoked = $this->revoker->revokeAll($user);

            $this->audit->log('staff.offboarded', $target, ['status' => $old], ['status' => 'offboarded'], [
                'reason' => $reason,
                'user_id' => $user->id,
                'roles' => $target->roles()->pluck('key')->all(),
                'all_branches' => $target->all_branches,
                'branch_ids' => $target->branchIds(),
                'login_disabled' => $user->status === UserStatus::Disabled->value,
                'revoked' => $revoked,
            ]);

            return $target;
        });

        return ['membership' => $membership, 'pending_work' => $this->pendingWork($membership)];
    }

    /* ======================================================================= Credentials */

    /** @return array{membership: TenantMembership, activation_code: string|null, expires_at: string} */
    public function resendInvitation(TenantMembership $target, string $delivery, bool $requireChange = false): array
    {
        $this->authorize(Permissions::STAFF_CREDENTIALS, $target, 'resend_invitation');
        $this->assertStatus($target, [MembershipStatus::Invited], 'resend_invitation');
        $this->assertCompanyManaged($target);
        $this->assertDeliverable($target, $delivery);

        if ($delivery === self::DELIVERY_TEMPORARY_PASSWORD) {
            return $this->temporaryResult($target, DB::transaction(fn () => $this->issueGeneratedPassword($target, 'onboarding', $requireChange)));
        }

        $result = DB::transaction(function () use ($target, $delivery) {
            $issued = $this->codes->issue($target, StaffInvitation::PURPOSE_ACTIVATION, $delivery, $this->actorId());
            $this->audit->log('staff.invitation_issued', $target, null, null, [
                'purpose' => 'activation', 'channel' => $delivery, 'reissued' => true, 'expires_at' => $issued['invitation']->expires_at->toIso8601String(),
            ]);

            return $issued;
        });

        return $this->deliver($target, $result['invitation'], $result['code']);
    }

    /**
     * Administrator-assisted recovery for company-managed accounts. The current password keeps working until the
     * code is redeemed; redemption revokes every session; the owner and the employee are notified.
     *
     * @return array{membership: TenantMembership, activation_code: string|null, expires_at: string}
     */
    public function issueRecovery(TenantMembership $target, string $delivery, bool $requireChange = false): array
    {
        $this->authorize(Permissions::STAFF_CREDENTIALS, $target, 'recovery');
        $this->assertStatus($target, [MembershipStatus::Active], 'recovery');
        $this->assertCompanyManaged($target, 'Personal accounts recover their password with the emailed reset link.');
        $this->assertDeliverable($target, $delivery);

        if ($delivery === self::DELIVERY_TEMPORARY_PASSWORD) {
            // Takes effect immediately: the old password stops working and every session ends, so a misuse is
            // noticed at once by the employee; the employee and owner are also notified and it is audited.
            $temporary = DB::transaction(fn () => $this->issueGeneratedPassword($target, 'recovery', $requireChange));
            $this->notifications->notifyUser($target->tenant_id, $target->user_id, 'password_recovered', 'Your password was reset',
                'An administrator ('.($this->context->membership()->user->name ?? 'unknown').') issued you a new password. If you did not ask for this, tell the business owner.');
            $this->notifyOwnerOfRecovery($target);

            return $this->temporaryResult($target, $temporary);
        }

        $result = DB::transaction(function () use ($target, $delivery) {
            $issued = $this->codes->issue($target, StaffInvitation::PURPOSE_RECOVERY, $delivery, $this->actorId());
            $this->audit->log('staff.recovery_issued', $target, null, null, [
                'channel' => $delivery, 'user_id' => $target->user_id, 'expires_at' => $issued['invitation']->expires_at->toIso8601String(),
            ]);

            return $issued;
        });

        $this->notifyOwnerOfRecovery($target);

        return $this->deliver($target, $result['invitation'], $result['code']);
    }

    private function notifyOwnerOfRecovery(TenantMembership $target): void
    {
        $tenant = $this->context->tenant();
        if ($this->actorId() !== $tenant->owner_user_id) {
            $this->notifications->notifyUser($tenant->id, $tenant->owner_user_id, 'staff_recovery_issued',
                "Password reset issued for {$target->user->name}",
                'A password reset was issued by '.($this->context->membership()->user->name ?? 'an administrator').'.',
                ['membership_id' => $target->id, 'issued_by' => $this->actorId()]);
        }
    }

    /* ======================================================================= Temporary passwords & profile */

    /**
     * Suggested identifiers for a new staff member: username from role + branch, next employee ID, and a company
     * email when the business has configured its staff email domain. Nothing is reserved until the account is saved.
     *
     * @return array{username: string, employee_code: string, email: string|null}
     */
    public function suggest(?int $roleId, ?int $branchId): array
    {
        $this->authorize(Permissions::STAFF_CREATE, null, 'suggest');
        $tenant = $this->context->tenant();
        $roleKey = $roleId ? Role::query()->availableTo($tenant->id)->whereKey($roleId)->value('key') : null;
        $branchCode = $branchId ? $tenant->branches()->whereKey($branchId)->value('code') : null;
        $username = $this->usernames->suggest($tenant->id, $roleKey, $branchCode);

        $email = null;
        if ($tenant->staff_email_domain) {
            $candidate = $username.'@'.Str::lower($tenant->staff_email_domain);
            $email = User::query()->where('email', $candidate)->exists() ? null : $candidate;
        }

        return ['username' => $username, 'employee_code' => $this->employeeCodes->next($tenant->id), 'email' => $email];
    }

    /**
     * Set a new generated password based on the business name (only its hash is stored), activate the login and
     * sign the user out everywhere. Permanent by default (the business chose this for simplicity); with
     * $requireChange it is temporary: it expires and must be replaced at next sign-in. Caller must hold a transaction.
     *
     * @return array{password: string, expires_at: string|null}
     */
    private function issueGeneratedPassword(TenantMembership $membership, string $purpose, bool $requireChange = false): array
    {
        $user = $membership->user()->firstOrFail();
        $password = CompanyPassword::generate($membership->tenant()->firstOrFail()->name);
        $expiresAt = $requireChange ? now()->addHours((int) config('smartpos.staff_code_ttl_hours', 72)) : null;

        $this->revoker->revokeAll($user);
        $user->forceFill([
            'password' => $password,
            'status' => UserStatus::Active->value,
            'must_change_password' => $requireChange,
            'temporary_password_expires_at' => $expiresAt,
        ])->save();

        if ($membership->hasStatus(MembershipStatus::Invited)) {
            $membership->forceFill(['status' => MembershipStatus::Active->value, 'joined_at' => now()])->save();
        }

        $this->audit->log('staff.temporary_password_issued', $membership, null, null, [
            'purpose' => $purpose,
            'user_id' => $user->id,
            'must_change' => $requireChange,
            'expires_at' => $expiresAt?->toIso8601String(),
        ]);

        return ['password' => $password, 'expires_at' => $expiresAt?->toIso8601String()];
    }

    /** @return array{membership: TenantMembership, activation_code: null, temporary_password: string, expires_at: string|null} */
    private function temporaryResult(TenantMembership $membership, array $temporary): array
    {
        return [
            'membership' => $membership->refresh(),
            'activation_code' => null,
            'temporary_password' => $temporary['password'],
            'expires_at' => $temporary['expires_at'],
        ];
    }

    /**
     * Create or update the staff profile. Returns the names of changed fields (values are personal data and are
     * deliberately not written to the audit log).
     *
     * @param  array<string, mixed>  $fields
     * @return list<string>
     */
    private function saveProfile(TenantMembership $membership, array $fields): array
    {
        $fields = array_intersect_key($fields, array_flip(StaffProfile::FIELDS));
        if ($fields === []) {
            return [];
        }

        $profile = $membership->profile()->first() ?? new StaffProfile;
        $profile->membership_id = $membership->id;
        $profile->tenant_id = $membership->tenant_id;
        $profile->fill($fields);
        $changed = array_keys($profile->getDirty());
        $profile->save();

        return array_values(array_diff($changed, ['tenant_id', 'membership_id']));
    }

    /* ======================================================================= Pending work */

    /** Work that should be handed over when someone leaves (open shifts, pending refunds, drafts). */
    public function pendingWork(TenantMembership $membership): array
    {
        $tenantId = $membership->tenant_id;
        $userId = $membership->user_id;

        return [
            'open_shifts' => DB::table('register_sessions')->where('tenant_id', $tenantId)->where('opened_by', $userId)
                ->where('status', 'open')->get(['id', 'register_id', 'branch_id', 'opened_at'])->all(),
            'pending_refunds' => DB::table('refunds')->where('tenant_id', $tenantId)->where('requested_by', $userId)
                ->where('status', RefundStatus::PendingApproval->value)->get(['id', 'reference', 'total'])->all(),
            'draft_transfers' => DB::table('stock_transfers')->where('tenant_id', $tenantId)->where('created_by', $userId)
                ->whereIn('status', ['draft', 'in_transit'])->get(['id', 'reference', 'status'])->all(),
            'draft_stock_counts' => DB::table('stock_counts')->where('tenant_id', $tenantId)->where('created_by', $userId)
                ->where('status', 'draft')->get(['id', 'reference'])->all(),
            'open_purchase_orders' => DB::table('purchase_orders')->where('tenant_id', $tenantId)->where('created_by', $userId)
                ->whereIn('status', ['draft', 'ordered', 'partially_received'])->get(['id', 'reference', 'status'])->all(),
            'how_to_reassign' => 'A manager with shifts.view_all can close open shifts; approvers can process pending refunds; drafts can be completed or cancelled by any authorized member of the branch.',
        ];
    }

    /* ======================================================================= Authorization */

    /**
     * Require a permission and, for a target, every scope rule. Denials are audited.
     */
    public function authorize(string $permission, ?TenantMembership $target, string $action): void
    {
        if (! $this->context->can($permission)) {
            $this->deny($action, $target, "missing_permission:{$permission}", 'You do not have permission to manage staff in this way.');
        }
        if ($target === null) {
            return;
        }

        $tenant = $this->context->tenant();
        if ($target->tenant_id !== $tenant->id) {
            $this->deny($action, null, 'cross_tenant', 'This action is unauthorized.');
        }
        if ($target->user_id === $this->actorId()) {
            $this->deny($action, $target, 'self', 'You cannot change your own account access.');
        }
        if ($target->user_id === $tenant->owner_user_id) {
            $this->deny($action, $target, 'owner', "The business owner's access cannot be changed.");
        }
        if (! $this->actorIsOwner() && $this->holdsPrivileged($target)) {
            $this->deny($action, $target, 'privileged_target', 'Only the business owner can change other administrators.');
        }
        if (! $this->context->hasAllBranches()) {
            $targetBranches = $target->branchIds();
            $outside = array_diff($targetBranches, $this->context->branchIds() ?? []);
            if ($target->all_branches || $targetBranches === [] || $outside !== []) {
                $this->deny($action, $target, 'branch_scope', 'This employee works at branches outside your access.');
            }
        }
    }

    /**
     * Non-owner administrators may assign only non-administrative roles (defined by the owner; custom roles can
     * only contain permissions their creator holds). Administrative roles are owner-only.
     *
     * @param  list<int>  $roleIds
     * @return EloquentCollection<int, Role>
     */
    private function resolveRoles(array $roleIds, string $action, ?TenantMembership $target = null): EloquentCollection
    {
        $roles = Role::query()->availableTo($this->context->tenantId())->whereIn('id', $roleIds)->with('permissions')->get();

        if ($roleIds === [] || $roles->count() !== count(array_unique($roleIds))) {
            throw new BusinessRuleException('One or more roles are invalid.', 'INVALID_ROLE', ['role_ids' => ['One or more roles are invalid.']]);
        }

        $keys = $roles->flatMap(fn (Role $r) => $r->permissions->pluck('key'))->unique();

        if (! $this->actorIsOwner()) {
            if ($roles->contains(fn (Role $r) => $r->key === Permissions::ROLE_OWNER && $r->tenant_id === null)
                || $keys->intersect(Permissions::PRIVILEGED)->isNotEmpty()) {
                $this->deny($action, $target, 'privileged_role', 'Only the business owner can grant administrative roles.');
            }
        }

        return $roles;
    }

    /**
     * @param  list<int>  $branchIds
     * @return array{0: bool, 1: list<int>}
     */
    private function resolveBranches(bool $allBranches, array $branchIds, string $action, ?TenantMembership $target = null): array
    {
        if ($allBranches) {
            if (! $this->context->hasAllBranches()) {
                $this->deny($action, $target, 'branch_scope', 'You cannot grant access to all branches.');
            }

            return [true, []];
        }

        $branchIds = array_values(array_unique(array_map('intval', $branchIds)));
        if ($branchIds === []) {
            throw new BusinessRuleException('Assign at least one branch.', 'BRANCH_REQUIRED', ['branch_ids' => ['Assign at least one branch.']]);
        }

        $valid = $this->context->tenant()->branches()->whereIn('id', $branchIds)->pluck('id')->map(fn ($id) => (int) $id)->all();
        if (count($valid) !== count($branchIds)) {
            throw new BusinessRuleException('One or more branches are invalid.', 'INVALID_BRANCH', ['branch_ids' => ['One or more branches are invalid.']]);
        }
        foreach ($valid as $branchId) {
            if (! $this->context->canAccessBranch($branchId)) {
                $this->deny($action, $target, 'branch_scope', 'You cannot assign branches you cannot access.');
            }
        }

        return [false, $valid];
    }

    private function deny(string $action, ?TenantMembership $target, string $reason, string $message): never
    {
        $this->audit->log('staff.unauthorized_attempt', $target, null, null, [
            'action' => $action,
            'reason' => $reason,
            'target_user_id' => $target?->user_id,
        ], tenantId: $this->context->tenantId());

        throw new AuthorizationException($message);
    }

    /**
     * Owners, managers and HR sign in with email only, so their account needs one.
     *
     * @param  Collection<int, Role>  $roles
     */
    private function assertEmailNotRequired(Collection $roles): void
    {
        if ($roles->contains(fn (Role $r) => $r->requiresEmailSignIn())) {
            throw new BusinessRuleException('Managers and administrators sign in with their email address. Enter an email for this account.',
                'EMAIL_REQUIRED', ['email' => ['Required for manager and administrator roles.']]);
        }
    }

    private function holdsPrivileged(TenantMembership $membership): bool
    {
        return array_intersect($membership->permissionKeys(), Permissions::PRIVILEGED) !== [];
    }

    /** @param  list<MembershipStatus>  $allowed */
    private function assertStatus(TenantMembership $target, array $allowed, string $action): void
    {
        if (! in_array(MembershipStatus::from($target->status), $allowed, true)) {
            throw new BusinessRuleException("Cannot {$action} a membership that is {$target->status}.", 'INVALID_STAFF_STATE');
        }
    }

    private function assertCompanyManaged(TenantMembership $target, string $message = 'Only company-managed accounts use activation codes.'): void
    {
        if ($target->user->managed_by_tenant_id !== $target->tenant_id) {
            throw new BusinessRuleException($message, 'PERSONAL_ACCOUNT');
        }
    }

    private function assertDeliverable(TenantMembership $target, string $delivery): void
    {
        if ($delivery === StaffInvitation::CHANNEL_EMAIL && ! $target->user->email) {
            throw new BusinessRuleException('This account has no email address; use manual delivery.', 'EMAIL_REQUIRED');
        }
    }

    /**
     * Email the code, or return it once for in-person hand-over. The code is never stored or logged.
     *
     * @return array{membership: TenantMembership, activation_code: string|null, expires_at: string}
     */
    private function deliver(TenantMembership $membership, StaffInvitation $invitation, string $code): array
    {
        if ($invitation->channel === StaffInvitation::CHANNEL_EMAIL) {
            $membership->user->notify(new StaffCodeNotification(
                $this->context->tenant(),
                $membership->user->username,
                $code,
                $invitation->purpose,
                $invitation->expires_at,
            ));
        }

        return [
            'membership' => $membership->refresh(),
            'activation_code' => $invitation->channel === StaffInvitation::CHANNEL_MANUAL ? $code : null,
            'temporary_password' => null,
            'expires_at' => $invitation->expires_at->toIso8601String(),
        ];
    }

    private function firstBranchCode(array $branchIds): ?string
    {
        return $branchIds === [] ? 'all' : $this->context->tenant()->branches()->whereKey($branchIds[0])->value('code');
    }

    private function actorId(): int
    {
        return $this->context->membership()->user_id;
    }

    private function actorIsOwner(): bool
    {
        return $this->actorId() === $this->context->tenant()->owner_user_id;
    }
}
