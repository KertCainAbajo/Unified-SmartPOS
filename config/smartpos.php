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

    // Staff sign-in shows a dropdown of every active store and branch. Turn off when this system hosts other
    // companies' stores and their names should not be listed publicly (staff then type a business code).
    'public_store_list' => (bool) env('SMARTPOS_PUBLIC_STORE_LIST', true),

    'staff_code_ttl_hours' => (int) env('SMARTPOS_STAFF_CODE_TTL_HOURS', 72),

    // Sign-in with email from a browser not used before needs a 6-digit code sent to that email (two-step sign-in).
    'new_device_codes' => (bool) env('SMARTPOS_NEW_DEVICE_CODES', true),

    // Refuse new passwords found in known data breaches (checked with Have I Been Pwned; only the first 5
    // characters of the password's SHA-1 hash leave the server). If the service cannot be reached, the check is skipped.
    'check_breached_passwords' => (bool) env('SMARTPOS_CHECK_BREACHED_PASSWORDS', true),

    // Multiplies every request speed limit. Only for automated test runs; keep 1 on a real server.
    'rate_limit_multiplier' => (int) env('SMARTPOS_RATE_LIMIT_MULTIPLIER', 1),

    // Where uploads are kept. On a host without a lasting disk (Vercel), set both to `s3` and fill the AWS_* settings
    // with Supabase Storage's S3 keys. Files are always served through the API, so the bucket stays private.
    'files_disk' => env('SMARTPOS_FILES_DISK', 'public'),
    'private_files_disk' => env('SMARTPOS_PRIVATE_FILES_DISK', 'local'),

    // Maximum page size accepted by paginated endpoints.
    'max_per_page' => 100,
];
