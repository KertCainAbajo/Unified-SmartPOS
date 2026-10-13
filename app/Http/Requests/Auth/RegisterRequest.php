<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:30'],
            'password' => ['required', 'confirmed', Password::defaults()],
            'business.name' => ['required', 'string', 'max:255'],
            'business.legal_name' => ['nullable', 'string', 'max:255'],
            'business.tin' => ['nullable', 'string', 'max:30'],
            'business.address' => ['nullable', 'string', 'max:255'],
            'business.phone' => ['nullable', 'string', 'max:30'],
            'business.email' => ['nullable', 'email:rfc', 'max:255'],
            'business.vat_registered' => ['sometimes', 'boolean'],
            'business.branch_name' => ['nullable', 'string', 'max:255'],
            'device_name' => ['nullable', 'string', 'max:100'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('email'))) {
            $this->merge(['email' => mb_strtolower(trim($this->input('email')))]);
        }
    }
}
