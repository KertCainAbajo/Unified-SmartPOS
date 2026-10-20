<?php

namespace App\Providers;

use App\Support\TenantContext;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->scoped(TenantContext::class);
    }

    public function boot(): void
    {
        // Fail loudly in development/tests when code assigns non-fillable or reads unselected attributes.
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());
        Model::preventAccessingMissingAttributes(! $this->app->isProduction());

        Password::defaults(fn () => Password::min(8)->max(128)->letters()->mixedCase()->numbers()
            ->when(config('smartpos.check_breached_passwords'), fn (Password $rule) => $rule->uncompromised()));

        ResetPassword::createUrlUsing(fn ($user, string $token) => rtrim(config('smartpos.frontend_url'), '/')
            .'/reset-password?token='.$token.'&email='.urlencode($user->getEmailForPasswordReset()));

        VerifyEmail::createUrlUsing(fn ($user) => URL::temporarySignedRoute(
            'api.v1.auth.verify-email',
            now()->addMinutes(60),
            ['id' => $user->getKey(), 'hash' => sha1($user->getEmailForVerification())],
        ));

        // Generic permission gate for endpoints not tied to a single model (reports, audit logs…).
        Gate::define('tenant-permission', fn ($user, string $permission) => app(TenantContext::class)->hasTenant()
            && app(TenantContext::class)->can($permission));

        $this->configureRateLimiting();
    }

    private function configureRateLimiting(): void
    {
        // SMARTPOS_RATE_LIMIT_MULTIPLIER raises every limit for automated test runs (one robot user clicking
        // non-stop from one computer). Keep it 1 on a real server. Account pauses after wrong passwords still apply.
        $multiplier = max(1, (int) config('smartpos.rate_limit_multiplier', 1));
        $n = fn (int $limit) => $limit * $multiplier;

        // Signed-in user, or guest IP address (shoppers on one store Wi-Fi share one). A dashboard page alone makes 10-15 requests.
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute($n(300))
            ->by($request->user()?->id ?: $request->ip()));

        RateLimiter::for('auth', fn (Request $request) => Limit::perMinute($n(10))->by($request->ip()));

        RateLimiter::for('login', fn (Request $request) => [
            Limit::perMinute($n(5))->by(mb_strtolower((string) ($request->input('email') ?: $request->input('business_code').'/'.$request->input('username'))).'|'.$request->ip()),
            Limit::perMinute($n(20))->by($request->ip()),
        ]);

        // Activation/recovery codes: slow down guessing per account and per IP.
        RateLimiter::for('staff-codes', fn (Request $request) => [
            Limit::perMinute($n(5))->by(mb_strtolower($request->input('business_code').'/'.$request->input('username')).'|'.$request->ip()),
            Limit::perMinute($n(20))->by($request->ip()),
        ]);

        // Public careers pages: applications, status checks and applicant actions.
        // Shop forgot-password codes: separate from sign-in so a few wrong passwords do not block a reset.
        RateLimiter::for('customer-codes', fn (Request $request) => [
            Limit::perMinute($n(10))->by(mb_strtolower((string) $request->input('email')).'|'.$request->ip()),
            Limit::perMinute($n(30))->by($request->ip()),
        ]);

        // Emailed sign-in codes: each sign-in allows a few guesses; this caps the rest per IP address.
        RateLimiter::for('login-codes', fn (Request $request) => [
            Limit::perMinute($n(10))->by('code|'.$request->ip()),
            Limit::perHour($n(60))->by('code|'.$request->ip()),
        ]);

        RateLimiter::for('public-applications', fn (Request $request) => Limit::perMinute($n(10))->by($request->ip()));

        RateLimiter::for('checkout', fn (Request $request) => Limit::perMinute($n(60))
            ->by($request->user()?->id ?: $request->ip()));
    }
}
