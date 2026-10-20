<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Security\NewDeviceVerification;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;
use Illuminate\Validation\ValidationException;

/**
 * @tags Authentication
 */
class PasswordResetController extends Controller
{
    /**
     * Request a password reset link.
     *
     * Always returns the same response whether or not the email exists.
     *
     * @unauthenticated
     */
    public function sendLink(Request $request): JsonResponse
    {
        $request->validate(['email' => ['required', 'email']]);

        Password::sendResetLink(['email' => mb_strtolower(trim($request->string('email')))]);

        return response()->json(['message' => 'If the account exists, a password reset link has been sent.']);
    }

    /**
     * Reset the password using the emailed token. All existing API tokens are revoked.
     *
     * @unauthenticated
     */
    public function reset(Request $request, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'email'],
            'password' => ['required', 'confirmed', PasswordRule::defaults()],
        ]);
        $data['email'] = mb_strtolower(trim($data['email']));

        $status = Password::reset($data, function (User $user, string $password) use ($audit) {
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
            $user->tokens()->delete();
            AuthController::endOtherSessions($user);
            app(NewDeviceVerification::class)->forgetDevices($user);
            $audit->log('auth.password_reset', $user, userId: $user->id);
            event(new PasswordReset($user));
        });

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages(['email' => __($status)]);
        }

        return response()->json(['message' => __($status)]);
    }
}
