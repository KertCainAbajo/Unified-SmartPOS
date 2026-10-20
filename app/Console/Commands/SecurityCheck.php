<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

/**
 * `php artisan smartpos:security-check` — run before deploying. Lists settings that would leave the live system
 * open (debug pages, cookies over plain HTTP, two-step sign-in off…). Exits with 1 when something must be fixed.
 */
class SecurityCheck extends Command
{
    protected $signature = 'smartpos:security-check {--production : Judge the settings as if this were the live server}';

    protected $description = 'Check the security settings before deploying';

    public function handle(): int
    {
        $live = $this->option('production') || app()->isProduction();
        $https = fn (?string $url) => is_string($url) && str_starts_with($url, 'https://');

        // [ok?, what, how to fix, must fix on a live server?]
        $checks = [
            [app()->isProduction(), 'APP_ENV is production', 'Set APP_ENV=production on the live server.', true],
            [! config('app.debug'), 'Debug pages are off (APP_DEBUG=false)', 'Set APP_DEBUG=false. Debug pages show code, settings and data to anyone.', true],
            [filled(config('app.key')), 'Encryption key is set (APP_KEY)', 'Run php artisan key:generate once and keep the key secret.', true],
            [$https(config('app.url')), 'API address uses HTTPS (APP_URL)', 'Serve the site only over HTTPS and set APP_URL=https://…', true],
            [$https(config('smartpos.frontend_url')), 'Web app address uses HTTPS (FRONTEND_URL)', 'Set FRONTEND_URL=https://… so emailed links are secure.', true],
            [(bool) config('session.secure'), 'Sign-in cookies are HTTPS-only (SESSION_SECURE_COOKIE)', 'Set SESSION_SECURE_COOKIE=true.', true],
            [(bool) config('session.http_only', true), 'Sign-in cookies are hidden from scripts', 'Keep SESSION_HTTP_ONLY=true.', true],
            [(bool) config('session.encrypt'), 'Saved sessions are encrypted (SESSION_ENCRYPT)', 'Set SESSION_ENCRYPT=true.', false],
            [(bool) config('smartpos.new_device_codes'), 'Two-step sign-in on new browsers is on', 'Set SMARTPOS_NEW_DEVICE_CODES=true.', true],
            [(bool) config('smartpos.check_breached_passwords'), 'Leaked passwords are refused', 'Set SMARTPOS_CHECK_BREACHED_PASSWORDS=true.', false],
            [! in_array(config('mail.default'), ['log', 'array'], true), 'Email really sends (MAIL_MAILER)', 'Configure SMTP: sign-in codes, password resets and security alerts go by email.', true],
            [! in_array(config('cache.default'), ['array', 'null'], true), 'Cache keeps data between requests (CACHE_STORE)', 'Use CACHE_STORE=database, file or redis. With array, sign-in limits and account pauses do not work.', true],
            [! filter_var(ini_get('expose_php'), FILTER_VALIDATE_BOOLEAN), 'PHP does not announce its version (expose_php)', 'Set expose_php = Off in php.ini.', false],
            [(int) config('smartpos.rate_limit_multiplier', 1) <= 1, 'Request speed limits are at normal strength', 'Remove SMARTPOS_RATE_LIMIT_MULTIPLIER (it is for automated tests only).', true],
            [(int) config('hashing.bcrypt.rounds', 12) >= 12, 'Passwords are hashed strongly (BCRYPT_ROUNDS ≥ 12)', 'Set BCRYPT_ROUNDS=12 or more.', true],
            [! file_exists(public_path('.env')) && ! file_exists(public_path('storage/backups')), 'No secrets inside the public folder', 'Remove .env or backups from public/.', true],
            [$this->backupsIgnored(), 'Backups are kept out of git', 'Keep storage/backups/.gitignore (it holds password hashes).', true],
        ];

        $failed = 0;
        $rows = [];
        foreach ($checks as [$ok, $what, $fix, $required]) {
            $status = $ok ? '<fg=green>OK</>' : ($required && $live ? '<fg=red>FIX</>' : '<fg=yellow>WARN</>');
            if (! $ok && $required && $live) {
                $failed++;
            }
            $rows[] = [$status, $what, $ok ? '' : $fix];
        }
        $this->table(['', 'Check', 'What to do'], $rows);

        if (! $live) {
            $this->line('This is a development setup, so problems are warnings. Run with --production to judge it as the live server.');
        }
        if ($failed > 0) {
            $this->error("{$failed} setting(s) must be fixed before going live.");

            return self::FAILURE;
        }
        $this->info('No blocking problems found.');

        return self::SUCCESS;
    }

    private function backupsIgnored(): bool
    {
        $ignore = storage_path('backups/.gitignore');

        return ! is_dir(storage_path('backups')) || (is_file($ignore) && str_contains((string) file_get_contents($ignore), '*'));
    }
}
