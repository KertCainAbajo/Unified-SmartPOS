<?php

namespace App\Http\Requests\Catalog;

use App\Enums\TaxType;
use App\Models\Product;
use App\Rules\Barcode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Create (POST) and update (PATCH) product. Price changes on update go through the price endpoint. */
class ProductRequest extends FormRequest
{
    /** Authorize before validating so unauthorized callers learn nothing from validation errors. */
    public function authorize(): bool
    {
        $product = $this->route('product');

        return $product instanceof Product
            ? $this->user()->can('update', $product)
            : $this->user()->can('create', Product::class);
    }

    public function rules(): array
    {
        $tenantId = $this->route('tenant')?->id;
        /** @var Product|null $product */
        $product = $this->route('product');
        $creating = $product === null;
        $required = $creating ? 'required' : 'sometimes';

        return [
            'sku' => [$required, 'string', 'max:64', 'regex:/^[A-Z0-9][A-Z0-9\-_.\/]*$/',
                Rule::unique('products', 'sku')->where('tenant_id', $tenantId)->ignore($product?->id)],
            'barcode' => ['sometimes', 'nullable', 'string', new Barcode,
                Rule::unique('products', 'barcode')->where('tenant_id', $tenantId)->ignore($product?->id)],
            'name' => [$required, 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'category_id' => ['sometimes', 'nullable', 'integer', Rule::exists('categories', 'id')->where('tenant_id', $tenantId)],
            'unit' => ['sometimes', 'string', 'max:20'],
            'tax_type' => ['sometimes', Rule::enum(TaxType::class)],
            'track_inventory' => ['sometimes', 'boolean'],
            'allow_decimal_quantity' => ['sometimes', 'boolean'],
            'reorder_level' => ['sometimes', 'numeric', 'decimal:0,3', 'min:0', 'max:999999999'],
            'show_online' => ['sometimes', 'boolean'],
            'price' => $creating ? ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:999999999'] : ['prohibited'],
            'cost_price' => $creating ? ['sometimes', 'numeric', 'decimal:0,4', 'min:0', 'max:999999999'] : ['prohibited'],
        ];
    }

    public function messages(): array
    {
        return [
            'price.prohibited' => 'Use the price endpoint to change prices.',
            'cost_price.prohibited' => 'Use the price endpoint to change costs.',
            'sku.regex' => 'The SKU may only contain letters, digits, dashes, underscores, dots and slashes.',
        ];
    }

    protected function prepareForValidation(): void
    {
        $normalized = [];
        if (is_string($this->input('sku'))) {
            $normalized['sku'] = strtoupper(trim($this->input('sku')));
        }
        if (is_string($this->input('barcode'))) {
            $normalized['barcode'] = trim($this->input('barcode')) ?: null;
        }
        $this->merge($normalized);
    }
}
