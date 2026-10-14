<?php

return [
    // Block tenant endpoints for users whose email is not verified.
    'require_email_verification' => (bool) env('SMARTPOS_REQUIRE_EMAIL_VERIFICATION', false),

    // Frontend base URL used in password reset and verification links sent by email.
    'frontend_url' => env('FRONTEND_URL', 'http://localhost:5173'),

    // Senior Citizen (RA 9994) and PWD (RA 10754) discount rate, in percent.
    'sc_pwd_discount_rate' => '20',

    // Lifetime of staff activation / recovery codes.
    // Default onboarding checklist created when a hire starts onboarding (required items gate account creation).
    'onboarding_tasks' => [
        ['key' => 'contract_signed', 'label' => 'Employment contract signed', 'required' => true],
        ['key' => 'government_ids', 'label' => 'SSS, PhilHealth, Pag-IBIG and TIN numbers recorded', 'required' => true],
        ['key' => 'documents_verified', 'label' => 'Required documents verified', 'required' => true],
        ['key' => 'orientation', 'label' => 'Orientation and policies briefing completed', 'required' => true],
        ['key' => 'uniform_issued', 'label' => 'Uniform / ID issued', 'required' => false],
    ],

    'staff_code_ttl_hours' => (int) env('SMARTPOS_STAFF_CODE_TTL_HOURS', 72),

    // Maximum page size accepted by paginated endpoints.
    'max_per_page' => 100,
];
