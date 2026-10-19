<?php

namespace App\Http\Controllers\Api\V1\Shop;

use App\Enums\OnlineOrderStatus;
use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\CustomerAccount;
use App\Models\User;
use App\Models\Inventory;
use App\Models\OnlineOrder;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Catalog\ProductImageService;
use App\Services\DocumentNumberer;
use App\Services\Shop\CustomerEmailVerificationService;
use App\Services\Shop\CustomerPasswordResetService;
use App\Services\Shop\OnlineOrderNotifier;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Public customer shop API. A shop account is isolated from staff authentication. */
class CustomerShopController extends Controller
{
    private const ADMIN_EMAIL_MESSAGE = 'This email now signs in as a platform administrator. Use the Management sign-in, or shop with a different email.';

    public function catalog(string $business): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $branches = $tenant->branches()->where('is_active', true)->orderBy('name')->get(['id', 'code', 'name', 'address', 'latitude', 'longitude']);
        $products = $tenant->products()->where('show_online', true)->where('status', 'active')->whereNull('archived_at')
            ->with('category:id,name')->orderBy('name')->get();
        $stockByProduct = Inventory::query()->where('tenant_id', $tenant->id)
            ->whereIn('branch_id', $branches->pluck('id'))->whereIn('product_id', $products->pluck('id'))
            ->get(['branch_id', 'product_id', 'quantity', 'reorder_level'])->groupBy('product_id');
        $products = $products
            ->map(fn (Product $product) => [
                'id' => $product->id, 'sku' => $product->sku, 'name' => $product->name,
                'description' => $product->description, 'unit' => $product->unit,
                'price' => $product->price, 'category' => $product->category?->name,
                'track_inventory' => $product->track_inventory,
                'reorder_level' => $product->reorder_level,
                'stock_by_branch' => $branches->mapWithKeys(function (Branch $branch) use ($product, $stockByProduct) {
                    $stock = $stockByProduct->get($product->id, collect())->firstWhere('branch_id', $branch->id);
                    return [$branch->id => ['quantity' => $stock?->quantity ?? '0.000', 'reorder_level' => $stock?->reorder_level]];
                }),
                'image_url' => $product->image_path ? route('api.v1.shop.products.image', [$tenant->slug, $product->id, 'v' => ProductImageService::version($product)], false) : null,
            ]);

        return response()->json(['business' => ['name' => $tenant->name, 'code' => $tenant->slug], 'branches' => $branches, 'data' => $products]);
    }

    /** A product photo for the shop. Only products listed online are served. */
    public function productImage(string $business, int $product, ProductImageService $images): \Symfony\Component\HttpFoundation\Response
    {
        $tenant = $this->shopTenant($business);
        $listed = $tenant->products()->where('show_online', true)->where('status', 'active')->findOrFail($product);

        return $images->response($listed);
    }

    /** Email a 6-digit reset code. Always answers the same way, so it never reveals whether an email has an account. */
    public function forgotPassword(Request $request, string $business, CustomerPasswordResetService $reset): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $data = $request->validate(['email' => ['required', 'email:rfc', 'max:255']]);
        $reset->request($tenant, $data['email']);

        return response()->json([
            'message' => 'If an account uses this email, we sent it a 6-digit code.',
            'expires_in_minutes' => CustomerPasswordResetService::CODE_MINUTES,
            'resend_after_seconds' => CustomerPasswordResetService::RESEND_SECONDS,
        ]);
    }

    /** Check a reset code before the customer types a new password. Wrong guesses count against the code. */
    public function verifyResetCode(Request $request, string $business, CustomerPasswordResetService $reset): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $data = $request->validate(['email' => ['required', 'email:rfc', 'max:255'], 'code' => ['required', 'digits:6']]);
        $reset->check($tenant, $data['email'], $data['code']);

        return response()->json(['message' => 'Code accepted.']);
    }

    /** Set a new password with a valid code. The customer then signs in with it. */
    public function resetPassword(Request $request, string $business, CustomerPasswordResetService $reset): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $data = $request->validate([
            'email' => ['required', 'email:rfc', 'max:255'], 'code' => ['required', 'digits:6'],
            'password' => ['required', 'string', 'min:10', 'max:128', 'confirmed'],
        ]);
        $reset->reset($tenant, $data['email'], $data['code'], $data['password']);

        return response()->json(['message' => 'Your password was changed. Sign in with your new password.']);
    }

    public function register(Request $request, string $business, CustomerEmailVerificationService $verification): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'], 'email' => ['required', 'email:rfc', 'max:255'],
            'phone' => ['required', 'string', 'max:30'], 'password' => ['required', 'string', 'min:10', 'max:128', 'confirmed'],
        ]);
        $email = mb_strtolower(trim($data['email']));
        if (User::query()->where('email', $email)->where('is_platform_admin', true)->exists()) {
            throw ValidationException::withMessages(['email' => [self::ADMIN_EMAIL_MESSAGE]]);
        }
        $existing = $tenant->customerAccounts()->where('email', $email)->first();
        if ($existing && $existing->status !== CustomerAccount::STATUS_UNVERIFIED) {
            throw ValidationException::withMessages(['email' => ['An account already uses this email.']]);
        }

        // Signing up again before confirming simply updates the details and sends a new code.
        $account = DB::transaction(function () use ($tenant, $data, $email, $existing) {
            if ($existing) {
                $existing->forceFill(['name' => trim($data['name']), 'phone' => trim($data['phone']), 'password' => $data['password']])->save();
                $existing->customer?->forceFill(['name' => trim($data['name']), 'phone' => trim($data['phone'])])->save();

                return $existing;
            }
            $customer = $tenant->customers()->create(['name' => trim($data['name']), 'email' => $email, 'phone' => trim($data['phone'])]);

            return $tenant->customerAccounts()->create([
                'customer_id' => $customer->id, 'name' => trim($data['name']), 'email' => $email,
                'phone' => trim($data['phone']), 'password' => $data['password'], 'status' => CustomerAccount::STATUS_UNVERIFIED,
            ]);
        });
        $wait = $verification->send($tenant, $account);

        return response()->json([
            'verification_required' => true, 'email' => $email,
            'message' => 'We sent a 6-digit code to your email. Enter it to finish creating your account.',
            'resend_after_seconds' => $wait ?: CustomerEmailVerificationService::RESEND_SECONDS,
        ], 202)->header('Cache-Control', 'no-store');
    }

    /** Finish sign-up: check the emailed code, activate the account and sign the customer in. */
    public function verifyEmail(Request $request, string $business, CustomerEmailVerificationService $verification): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $data = $request->validate(['email' => ['required', 'email:rfc', 'max:255'], 'code' => ['required', 'digits:6'], 'remember' => ['sometimes', 'boolean']]);
        $account = $verification->verify($tenant, $data['email'], $data['code']);

        // Shoppers stay signed in on their own device unless they untick "Keep me signed in".
        Auth::guard('customer')->login($account, $request->boolean('remember', true));
        $request->session()->regenerate();

        return response()->json(['data' => $this->accountView($account)])->header('Cache-Control', 'no-store');
    }

    public function login(Request $request, string $business): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $data = $request->validate(['email' => ['required', 'email:rfc', 'max:255'], 'password' => ['required', 'string', 'max:128']]);
        $account = $tenant->customerAccounts()->where('email', mb_strtolower(trim($data['email'])))->first();
        if (! $account || ! Hash::check($data['password'], $account->password)) {
            return response()->json(['message' => 'The provided credentials are incorrect.'], 422);
        }
        // Shown only after the password matched, so it never reveals which emails are administrators.
        if ($account->status === CustomerAccount::STATUS_MOVED_TO_ADMIN || CustomerAccount::emailIsPlatformAdmin($account->email)) {
            CustomerAccount::closeForAdmin($account->email);
            return response()->json(['message' => self::ADMIN_EMAIL_MESSAGE, 'code' => 'MOVED_TO_ADMIN'], 422);
        }
        if ($account->status === CustomerAccount::STATUS_UNVERIFIED) {
            $wait = app(CustomerEmailVerificationService::class)->send($tenant, $account);

            return response()->json([
                'message' => 'Confirm your email first. We sent a 6-digit code to '.$account->email.'.', 'code' => 'EMAIL_NOT_VERIFIED',
                'email' => $account->email, 'resend_after_seconds' => $wait ?: CustomerEmailVerificationService::RESEND_SECONDS,
            ], 422);
        }
        if (! $account->isActive()) {
            return response()->json(['message' => 'The provided credentials are incorrect.'], 422);
        }
        Auth::guard('customer')->login($account, $request->boolean('remember', true));
        $request->session()->regenerate();
        $account->forceFill(['last_login_at' => now()])->save();

        return response()->json(['data' => $this->accountView($account)])->header('Cache-Control', 'no-store');
    }

    /** Email another sign-up code. Answers the same way whether or not the email is waiting for confirmation. */
    public function resendVerification(Request $request, string $business, CustomerEmailVerificationService $verification): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $data = $request->validate(['email' => ['required', 'email:rfc', 'max:255']]);
        $account = $tenant->customerAccounts()->where('email', mb_strtolower(trim($data['email'])))->where('status', CustomerAccount::STATUS_UNVERIFIED)->first();
        $wait = $account ? $verification->send($tenant, $account) : 0;

        return response()->json(['message' => 'If this email is waiting for confirmation, we sent it a new code.', 'resend_after_seconds' => $wait ?: CustomerEmailVerificationService::RESEND_SECONDS]);
    }

    public function logout(Request $request, string $business): JsonResponse
    {
        $this->accountFor($business);
        Auth::guard('customer')->logout();
        // Keep a separately authenticated staff guard in this browser session intact.
        $request->session()->regenerate();
        $request->session()->regenerateToken();
        return response()->json(['message' => 'Signed out.']);
    }

    public function me(string $business): JsonResponse
    {
        return response()->json(['data' => $this->accountView($this->accountFor($business))]);
    }

    /** Update the name and mobile number the store and rider use to reach the customer. */
    public function updateProfile(Request $request, string $business): JsonResponse
    {
        $account = $this->accountFor($business);
        $data = $request->validate(['name' => ['required', 'string', 'max:255'], 'phone' => ['required', 'string', 'max:30']]);
        $account->forceFill(['name' => trim($data['name']), 'phone' => trim($data['phone'])])->save();
        $account->customer?->forceFill(['name' => trim($data['name']), 'phone' => trim($data['phone'])])->save();

        return response()->json(['data' => $this->accountView($account)]);
    }

    /** Change the password while signed in (the current password is required). Other devices are signed out. */
    public function changePassword(Request $request, string $business): JsonResponse
    {
        $account = $this->accountFor($business);
        $data = $request->validate([
            'current_password' => ['required', 'string', 'max:128'],
            'password' => ['required', 'string', 'min:10', 'max:128', 'confirmed', 'different:current_password'],
        ]);
        if (! Hash::check($data['current_password'], $account->password)) {
            throw ValidationException::withMessages(['current_password' => 'Your current password is not correct.']);
        }
        $account->forceFill(['password' => $data['password'], 'remember_token' => Str::random(60)])->save();
        Auth::guard('customer')->login($account, true);
        $request->session()->regenerate();

        return response()->json(['message' => 'Your password was changed.']);
    }

    public function orders(string $business): JsonResponse
    {
        $account = $this->accountFor($business);
        $orders = $account->orders()->with(['branch:id,name,address,latitude,longitude', 'items:id,online_order_id,name,sku,unit,unit_price,quantity,line_total'])
            ->latest('id')->paginate(20)->through(fn (OnlineOrder $order) => $order->customerView());
        return response()->json($orders);
    }

    /**
     * The customer's in-store purchases at this business (sales rung up for their customer record), so their
     * counter and online history read as one.
     */
    public function purchases(string $business): JsonResponse
    {
        $account = $this->accountFor($business);
        if (! $account->customer_id) {
            return response()->json(['data' => [], 'total' => 0]);
        }
        $sales = $account->tenant->sales()->where('customer_id', $account->customer_id)->where('status', 'completed')
            ->with(['branch:id,name', 'items:id,sale_id,name,unit,quantity,line_total'])
            ->latest('id')->paginate(20)
            ->through(fn ($sale) => [
                'id' => $sale->id, 'receipt_number' => $sale->receipt_number, 'total' => $sale->total,
                'business_date' => $sale->business_date?->format('Y-m-d'), 'created_at' => $sale->created_at,
                'branch' => ['name' => $sale->branch?->name],
                'online_order_number' => OnlineOrder::query()->where('sale_id', $sale->id)->value('order_number'),
                'items' => $sale->items->map(fn ($i) => ['id' => $i->id, 'name' => $i->name, 'unit' => $i->unit, 'quantity' => $i->quantity, 'line_total' => $i->line_total])->values(),
            ]);

        return response()->json($sales);
    }

    public function placeOrder(Request $request, string $business, DocumentNumberer $numberer, OnlineOrderNotifier $notify): JsonResponse
    {
        $account = $this->accountFor($business);
        $tenant = $account->tenant;
        $data = $request->validate([
            'branch_id' => ['required', 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)->where('is_active', true)],
            'contact_name' => ['required', 'string', 'max:255'], 'contact_phone' => ['required', 'string', 'max:30'],
            'note' => ['nullable', 'string', 'max:1000'], 'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'integer', 'distinct', Rule::exists('products', 'id')->where('tenant_id', $tenant->id)->where('show_online', true)->where('status', 'active')],
            'items.*.quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0', 'max:99999'],
            'fulfilment' => ['sometimes', Rule::in(['pickup', 'delivery'])],
            'delivery_address' => ['required_if:fulfilment,delivery', 'nullable', 'string', 'min:10', 'max:500'],
            // Optional exact spot pinned on the map; both or neither.
            'delivery_lat' => ['nullable', 'numeric', 'between:-90,90', 'required_with:delivery_lng'],
            'delivery_lng' => ['nullable', 'numeric', 'between:-180,180', 'required_with:delivery_lat'],
            // Cash the customer will hand the rider, so the right change can be sent along.
            'cash_amount' => ['required_if:fulfilment,delivery', 'nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:1000000'],
        ], [
            'delivery_address.required_if' => 'Enter the delivery address.',
            'cash_amount.required_if' => 'Enter how much cash you will pay the rider with.',
        ]);
        $delivery = ($data['fulfilment'] ?? 'pickup') === 'delivery';
        $branch = Branch::query()->where('tenant_id', $tenant->id)->where('is_active', true)->findOrFail($data['branch_id']);

        $order = DB::transaction(function () use ($account, $tenant, $branch, $data, $numberer, $delivery) {
            $products = $tenant->products()->whereIn('id', collect($data['items'])->pluck('product_id'))->where('show_online', true)
                ->where('status', 'active')->whereNull('archived_at')->get()->keyBy('id');
            $total = '0.00';
            $lines = [];
            foreach ($data['items'] as $line) {
                /** @var Product|null $product */
                $product = $products->get((int) $line['product_id']);
                if (! $product) {
                    throw ValidationException::withMessages(['items' => ['One or more products are no longer available. Refresh the shop and try again.']]);
                }
                $quantity = Money::normalize($line['quantity'], 3);
                $wholeQuantity = rtrim(rtrim($quantity, '0'), '.');
                if (! $product->allow_decimal_quantity && str_contains($wholeQuantity, '.')) {
                    throw ValidationException::withMessages(['items' => ["{$product->name} must be ordered in whole units."]]);
                }
                $lineTotal = Money::round(Money::mul((string) $product->price, $quantity));
                $total = Money::add($total, $lineTotal);
                $lines[] = ['product' => $product, 'quantity' => $quantity, 'line_total' => $lineTotal];
            }

            $total = Money::round($total);
            $cash = $delivery ? Money::normalize((string) $data['cash_amount']) : null;
            if ($cash !== null && Money::cmp($cash, $total) < 0) {
                throw ValidationException::withMessages(['cash_amount' => ["The cash amount must cover the order total of ₱{$total}."]]);
            }

            $order = OnlineOrder::query()->create([
                'tenant_id' => $tenant->id, 'branch_id' => $branch->id, 'customer_account_id' => $account->id,
                'order_number' => $numberer->next($tenant->id, 'online_order', $branch), 'contact_name' => trim($data['contact_name']),
                'contact_phone' => trim($data['contact_phone']), 'note' => $data['note'] ?? null,
                'fulfilment' => $delivery ? 'delivery' : 'pickup',
                'delivery_address' => $delivery ? trim($data['delivery_address']) : null,
                'delivery_lat' => $delivery && isset($data['delivery_lat']) ? round((float) $data['delivery_lat'], 7) : null,
                'delivery_lng' => $delivery && isset($data['delivery_lng']) ? round((float) $data['delivery_lng'], 7) : null,
                'estimated_total' => $total, 'cash_amount' => $cash, 'placed_at' => now(),
            ]);
            foreach ($lines as $line) {
                $product = $line['product'];
                $order->items()->create([
                    'product_id' => $product->id, 'name' => $product->name, 'sku' => $product->sku, 'unit' => $product->unit,
                    'unit_price' => $product->price, 'quantity' => $line['quantity'], 'line_total' => $line['line_total'],
                ]);
            }
            return $order;
        });

        $notify->placed($order);

        return response()->json(['data' => $order->load(['branch:id,name,address,latitude,longitude', 'items'])->customerView()], 201);
    }

    public function cancelOrder(string $business, int $order, OnlineOrderNotifier $notify): JsonResponse
    {
        $account = $this->accountFor($business);
        $order = $account->orders()->with('items')->findOrFail($order);
        if (! $order->status->customerMayCancel()) {
            return response()->json(['message' => 'This order can no longer be cancelled.', 'code' => 'ORDER_NOT_CANCELLABLE'], 409);
        }
        DB::transaction(function () use ($order) {
            $locked = OnlineOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            if (! $locked->status->customerMayCancel()) {
                throw ValidationException::withMessages(['order' => ['This order can no longer be cancelled.']]);
            }
            $locked->forceFill(['status' => OnlineOrderStatus::Cancelled, 'cancelled_at' => now(), 'cancelled_by' => 'customer'])->save();
        });
        $notify->cancelledByCustomer($order);
        return response()->json(['data' => $order->fresh(['branch:id,name,address,latitude,longitude', 'items'])->customerView()]);
    }

    private function shopTenant(string $business): Tenant
    {
        $tenant = Tenant::query()->where('slug', mb_strtolower($business))->where('status', 'active')->firstOrFail();
        abort_unless($tenant->shop_enabled, 404);
        return $tenant;
    }

    private function accountFor(string $business): CustomerAccount
    {
        $tenant = $this->shopTenant($business);
        $account = Auth::guard('customer')->user();
        if ($account instanceof CustomerAccount && $account->isActive() && CustomerAccount::emailIsPlatformAdmin($account->email)) {
            CustomerAccount::closeForAdmin($account->email);
            Auth::guard('customer')->logoutCurrentDevice();
            abort(response()->json(['message' => self::ADMIN_EMAIL_MESSAGE, 'code' => 'MOVED_TO_ADMIN'], 403));
        }
        abort_unless($account instanceof CustomerAccount && $account->tenant_id === $tenant->id && $account->isActive(), 403, 'Customer account is not available for this shop.');
        return $account;
    }

    private function accountView(CustomerAccount $account): array
    {
        return ['id' => $account->id, 'name' => $account->name, 'email' => $account->email, 'phone' => $account->phone];
    }
}
