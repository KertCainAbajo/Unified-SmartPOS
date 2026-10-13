<?php

namespace Tests\Feature\Pos;

use App\Models\Branch;
use App\Models\Register;
use App\Models\RegisterSession;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

trait PosTestHelpers
{
    protected function openShift(Tenant $tenant, User $user, Register $register, string $float = '1000.00'): RegisterSession
    {
        $this->actingAsUser($user)->postJson($this->tenantUrl($tenant, 'register-sessions'), [
            'register_id' => $register->id,
            'opening_float' => $float,
        ])->assertCreated();

        return RegisterSession::query()->where('register_id', $register->id)->where('status', 'open')->firstOrFail();
    }

    protected function checkout(Tenant $tenant, Register $register, array $items, array $payments, array $extra = [], ?string $key = null): TestResponse
    {
        return $this->withHeader('Idempotency-Key', $key ?? (string) Str::uuid())
            ->postJson($this->tenantUrl($tenant, 'sales'), [
                'register_id' => $register->id,
                'items' => $items,
                'payments' => $payments,
                ...$extra,
            ]);
    }

    protected function mainRegister(Branch $branch): Register
    {
        return $this->registerFor($branch);
    }
}
