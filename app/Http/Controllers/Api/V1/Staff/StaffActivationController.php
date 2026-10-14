<?php

namespace App\Http\Controllers\Api\V1\Staff;

use App\Http\Controllers\Controller;
use App\Services\Staff\StaffActivationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Password;

/**
 * @tags Staff accounts
 */
class StaffActivationController extends Controller
{
    public function __construct(private readonly StaffActivationService $activation) {}

    /**
     * Activate a staff account, or redeem a recovery code, and choose a password.
     *
     * Codes are single-use, expire, and are locked after 5 wrong attempts. The error message is the same for
     * every failure so it reveals nothing about the account.
     *
     * @unauthenticated
     */
    public function activate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'business_code' => ['required', 'string', 'max:255'],
            'username' => ['required', 'string', 'max:50'],
            'code' => ['required', 'string', 'max:100'],
            'password' => ['required', 'confirmed', Password::defaults()],
        ]);

        $this->activation->redeem($data['business_code'], $data['username'], $data['code'], $data['password']);

        return response()->json(['message' => 'Your password is set. You can now sign in with your business code and username.']);
    }

    /**
     * Ask for help signing in (company-managed accounts). Accounts with an email receive a reset link; otherwise
     * the business's staff administrators are notified. The response is always the same.
     *
     * @unauthenticated
     */
    public function forgotPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'business_code' => ['required', 'string', 'max:255'],
            'username' => ['required', 'string', 'max:50'],
        ]);

        $this->activation->requestHelp($data['business_code'], $data['username']);

        return response()->json(['message' => 'If the account exists, a reset link was emailed or your administrator was notified. Ask your manager for a recovery code.']);
    }
}
