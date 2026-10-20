<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Browser protection headers on every response: no framing (clickjacking), no MIME sniffing, no referrer
 * leaks to other sites, no camera/microphone access, and HTTPS-only (HSTS) once the site runs on HTTPS.
 * API answers are data, so they also get a "load nothing" content security policy.
 */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $headers = $response->headers;

        $headers->set('X-Content-Type-Options', 'nosniff');
        $headers->set('X-Frame-Options', 'DENY');
        $headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $headers->set('Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)');
        $headers->set('Cross-Origin-Opener-Policy', 'same-origin');
        // PHP adds its version itself (expose_php); drop it so attackers do not learn which PHP flaws to try.
        $headers->remove('X-Powered-By');
        if (! headers_sent()) {
            header_remove('X-Powered-By');
        }

        if ($request->is('api/*') && ! $headers->has('Content-Security-Policy')) {
            $headers->set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        }
        if ($request->isSecure()) {
            $headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }
}
