<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Sign in with an email, or (company-managed staff) business code + username or employee ID.
 * Owners, managers and HR always use email.
 */
class LoginRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'email' => ['required_without:username', 'nullable', 'string', 'email'],
            'business_code' => ['required_with:username', 'nullable', 'string', 'max:255'],
            // Username or employee ID.
            'username' => ['required_without:email', 'nullable', 'string', 'max:50'],
            'password' => ['required', 'string'],
            // Present for mobile/API clients that need a bearer token. Omit for SPA cookie login.
            'device_name' => ['nullable', 'string', 'max:100'],
            // Staff: the branch they are signing in at. Must be one they are assigned to.
            'branch_id' => ['nullable', 'integer'],
        ];
    }

    /** Stable identifier used for rate limiting and audit (never the password). */
    public function identifier(): string
    {
        return $this->filled('username')
            ? mb_strtolower(trim((string) $this->input('business_code'))).'/'.mb_strtolower(trim((string) $this->input('username')))
            : mb_strtolower(trim((string) $this->input('email')));
    }

    protected function prepareForValidation(): void
    {
        $merge = [];
        foreach (['email', 'username', 'business_code'] as $field) {
            if (is_string($this->input($field))) {
                $merge[$field] = mb_strtolower(trim($this->input($field)));
            }
        }
        $this->merge($merge);
    }
}
