<?php

return [
    // Block tenant endpoints for users whose email is not verified.
    'require_email_verification' => (bool) env('SMARTPOS_REQUIRE_EMAIL_VERIFICATION', false),

    // Frontend base URL used in password reset and verification links sent by email.
    'frontend_url' => env('FRONTEND_URL', 'http://localhost:5173'),

    // Senior Citizen (RA 9994) and PWD (RA 10754) discount rate, in percent.
    'sc_pwd_discount_rate' => '20',

    // Lifetime of staff activation / recovery codes.
    'staff_code_ttl_hours' => (int) env('SMARTPOS_STAFF_CODE_TTL_HOURS', 72),

    // Maximum page size accepted by paginated endpoints.
    'max_per_page' => 100,
];
