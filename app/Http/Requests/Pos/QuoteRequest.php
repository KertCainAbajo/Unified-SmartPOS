<?php

namespace App\Http\Requests\Pos;

/** Cart pricing preview: same rules as checkout, without idempotency key or payments. */
class QuoteRequest extends CheckoutRequest
{
    public function rules(): array
    {
        $rules = parent::rules();
        unset($rules['idempotency_key'], $rules['payments'], $rules['payments.*.method'],
            $rules['payments.*.amount'], $rules['payments.*.reference_number'], $rules['customer_id'], $rules['notes']);

        return $rules;
    }

    protected function prepareForValidation(): void {}
}
