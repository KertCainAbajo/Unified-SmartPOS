<?php

namespace App\Http\Requests\Pos;

use App\Enums\LineDiscountType;
use App\Enums\PaymentMethod;
use App\Enums\SaleDiscountType;
use App\Models\Register;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Checkout payload. Only identifiers, quantities, discount requests and tendered amounts are accepted:
 * prices, totals, VAT and stock are always computed by the server.
 */
class CheckoutRequest extends FormRequest
{
    public function authorize(): bool
    {
        $context = app(TenantContext::class);
        if (! $context->can(Permissions::SALES_CREATE)) {
            return false;
        }

        // Branch access is derived from the register, never from client input.
        $register = Register::query()->where('tenant_id', $context->tenantId())->find($this->integer('register_id'));

        return $register === null || $context->canAccessBranch($register->branch_id);
    }

    public function rules(): array
    {
        $tenantId = $this->route('tenant')?->id;
        $discountType = $this->input('discount.type', 'none');

        return [
            'idempotency_key' => ['required', 'string', 'min:8', 'max:100', 'regex:/^[A-Za-z0-9_\-:.]+$/'],
            'register_id' => ['required', 'integer', Rule::exists('registers', 'id')->where('tenant_id', $tenantId)],
            'customer_id' => ['nullable', 'integer', Rule::exists('customers', 'id')->where('tenant_id', $tenantId)],
            'notes' => ['nullable', 'string', 'max:500'],

            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'integer', Rule::exists('products', 'id')->where('tenant_id', $tenantId)],
            'items.*.quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0', 'max:99999'],
            'items.*.discount' => ['sometimes', 'array:type,value'],
            'items.*.discount.type' => ['required_with:items.*.discount', Rule::enum(LineDiscountType::class)],
            'items.*.discount.value' => ['required_with:items.*.discount', 'numeric', 'decimal:0,2', 'min:0'],

            'discount' => ['sometimes', 'array:type,id_number,holder_name'],
            'discount.type' => ['required_with:discount', Rule::enum(SaleDiscountType::class)],
            'discount.id_number' => [Rule::requiredIf($discountType !== 'none'), 'nullable', 'string', 'max:50'],
            'discount.holder_name' => [Rule::requiredIf($discountType !== 'none'), 'nullable', 'string', 'max:255'],

            'payments' => ['present', 'array', 'max:10'],
            'payments.*.method' => ['required', Rule::enum(PaymentMethod::class)],
            'payments.*.amount' => ['required', 'numeric', 'decimal:0,2', 'gt:0', 'max:999999999'],
            'payments.*.reference_number' => ['nullable', 'string', 'max:100'],

            // Explicitly rejected: clients may not dictate these.
            'total' => ['prohibited'],
            'subtotal' => ['prohibited'],
            'items.*.price' => ['prohibited'],
            'items.*.unit_price' => ['prohibited'],
        ];
    }

    /** The idempotency key may be sent as the `Idempotency-Key` header (preferred) or in the body. */
    protected function prepareForValidation(): void
    {
        if ($this->hasHeader('Idempotency-Key')) {
            $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]);
        }
    }
}
