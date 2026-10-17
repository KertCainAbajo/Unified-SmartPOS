<?php

namespace App\Http\Controllers\Api\V1\Shop;

use App\Enums\OnlineOrderStatus;
use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\CustomerAccount;
use App\Models\OnlineOrder;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Catalog\ProductImageService;
use App\Services\DocumentNumberer;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Public customer shop API. A shop account is isolated from staff authentication. */
class CustomerShopController extends Controller
{
    public function catalog(string $business): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $branches = $tenant->branches()->where('is_active', true)->orderBy('name')->get(['id', 'code', 'name', 'address']);
        $products = $tenant->products()->where('show_online', true)->where('status', 'active')->whereNull('archived_at')
            ->with('category:id,name')->orderBy('name')->get()
            ->map(fn (Product $product) => [
                'id' => $product->id, 'sku' => $product->sku, 'name' => $product->name,
                'description' => $product->description, 'unit' => $product->unit,
                'price' => $product->price, 'category' => $product->category?->name,
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

    public function register(Request $request, string $business): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'], 'email' => ['required', 'email:rfc', 'max:255'],
            'phone' => ['required', 'string', 'max:30'], 'password' => ['required', 'string', 'min:10', 'max:128', 'confirmed'],
        ]);
        $email = mb_strtolower(trim($data['email']));
        if ($tenant->customerAccounts()->where('email', $email)->exists()) {
            throw ValidationException::withMessages(['email' => ['An account already uses this email.']]);
        }

        $account = DB::transaction(function () use ($tenant, $data, $email) {
            $customer = $tenant->customers()->create(['name' => trim($data['name']), 'email' => $email, 'phone' => trim($data['phone'])]);
            return $tenant->customerAccounts()->create([
                'customer_id' => $customer->id, 'name' => trim($data['name']), 'email' => $email,
                'phone' => trim($data['phone']), 'password' => $data['password'],
            ]);
        });

        Auth::guard('customer')->login($account);
        $request->session()->regenerate();

        return response()->json(['data' => $this->accountView($account)], 201)->header('Cache-Control', 'no-store');
    }

    public function login(Request $request, string $business): JsonResponse
    {
        $tenant = $this->shopTenant($business);
        $data = $request->validate(['email' => ['required', 'email:rfc', 'max:255'], 'password' => ['required', 'string', 'max:128']]);
        $account = $tenant->customerAccounts()->where('email', mb_strtolower(trim($data['email'])))->first();
        if (! $account || ! $account->isActive() || ! Hash::check($data['password'], $account->password)) {
            return response()->json(['message' => 'The provided credentials are incorrect.'], 422);
        }
        Auth::guard('customer')->login($account, (bool) $request->input('remember', false));
        $request->session()->regenerate();
        $account->forceFill(['last_login_at' => now()])->save();

        return response()->json(['data' => $this->accountView($account)])->header('Cache-Control', 'no-store');
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

    public function orders(string $business): JsonResponse
    {
        $account = $this->accountFor($business);
        $orders = $account->orders()->with(['branch:id,name', 'items:id,online_order_id,name,sku,unit,unit_price,quantity,line_total'])
            ->latest('id')->paginate(20);
        return response()->json($orders);
    }

    public function placeOrder(Request $request, string $business, DocumentNumberer $numberer): JsonResponse
    {
        $account = $this->accountFor($business);
        $tenant = $account->tenant;
        $data = $request->validate([
            'branch_id' => ['required', 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)->where('is_active', true)],
            'contact_name' => ['required', 'string', 'max:255'], 'contact_phone' => ['required', 'string', 'max:30'],
            'note' => ['nullable', 'string', 'max:1000'], 'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'integer', 'distinct', Rule::exists('products', 'id')->where('tenant_id', $tenant->id)->where('show_online', true)->where('status', 'active')],
            'items.*.quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0', 'max:99999'],
        ]);
        $branch = Branch::query()->where('tenant_id', $tenant->id)->where('is_active', true)->findOrFail($data['branch_id']);

        $order = DB::transaction(function () use ($account, $tenant, $branch, $data, $numberer) {
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

            $order = OnlineOrder::query()->create([
                'tenant_id' => $tenant->id, 'branch_id' => $branch->id, 'customer_account_id' => $account->id,
                'order_number' => $numberer->next($tenant->id, 'online_order', $branch), 'contact_name' => trim($data['contact_name']),
                'contact_phone' => trim($data['contact_phone']), 'note' => $data['note'] ?? null,
                'estimated_total' => Money::round($total), 'placed_at' => now(),
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

        return response()->json(['data' => $order->load(['branch:id,name', 'items'])], 201);
    }

    public function cancelOrder(string $business, int $order): JsonResponse
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
        return response()->json(['data' => $order->fresh(['branch:id,name', 'items'])]);
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
        abort_unless($account instanceof CustomerAccount && $account->tenant_id === $tenant->id && $account->isActive(), 403, 'Customer account is not available for this shop.');
        return $account;
    }

    private function accountView(CustomerAccount $account): array
    {
        return ['id' => $account->id, 'name' => $account->name, 'email' => $account->email, 'phone' => $account->phone];
    }
}
