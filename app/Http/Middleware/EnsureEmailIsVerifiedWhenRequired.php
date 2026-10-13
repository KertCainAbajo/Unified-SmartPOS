<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Enforces email verification only when SMARTPOS_REQUIRE_EMAIL_VERIFICATION=true. */
class EnsureEmailIsVerifiedWhenRequired
{
    public function handle(Request $request, Closure $next): Response
    {
        if (config('smartpos.require_email_verification') && ! $request->user()?->hasVerifiedEmail()) {
            return response()->json([
                'message' => 'Your email address is not verified.',
                'code' => 'EMAIL_NOT_VERIFIED',
            ], 403);
        }

        return $next($request);
    }
}
