<?php

namespace App\Http\Controllers\Api\V1\Pos;

use App\Http\Controllers\Controller;
use App\Http\Requests\Pos\CheckoutRequest;
use App\Http\Requests\Pos\QuoteRequest;
use App\Http\Resources\SaleResource;
use App\Models\Sale;
use App\Models\Tenant;
use App\Services\Pos\CheckoutService;
use App\Services\Pos\ReceiptBuilder;
use App\Services\Pos\SaleVoidService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * @tags Sales and checkout
 */
class SaleController extends Controller
{
    /**
     * List sales.
     *
     * Cashiers (`sales.view`) see their own sales; `sales.view_all` sees all sales in authorized branches.
     * Filters: `date_from`, `date_to` (business date, YYYY-MM-DD), `branch_id`, `cashier_id`, `status`,
     * `register_session_id`, `receipt_number`, `channel` (`in_store`, `pickup`, `delivery`).
     */
    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Sale::class);
        $request->validate([
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'channel' => ['sometimes', Rule::in(['in_store', 'pickup', 'delivery'])],
        ]);

        $sales = $this->scopeToAccessibleBranches($tenant->sales())
            ->with(['cashier:id,name', 'onlineOrder:id,sale_id,order_number,fulfilment,rider_name,delivery_address'])
            ->when(! $this->tenantContext()->can(Permissions::SALES_VIEW_ALL), fn ($q) => $q->where('cashier_id', $request->user()->id))
            ->when($request->filled('date_from'), fn ($q) => $q->where('business_date', '>=', $request->string('date_from')))
            ->when($request->filled('date_to'), fn ($q) => $q->where('business_date', '<=', $request->string('date_to')))
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->when($request->filled('cashier_id'), fn ($q) => $q->where('cashier_id', $request->integer('cashier_id')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('register_session_id'), fn ($q) => $q->where('register_session_id', $request->integer('register_session_id')))
            ->when($request->filled('receipt_number'), fn ($q) => $q->where('receipt_number', $request->string('receipt_number')))
            ->when($request->input('channel') === 'in_store', fn ($q) => $q->whereDoesntHave('onlineOrder'))
            ->when(in_array($request->input('channel'), ['pickup', 'delivery'], true), fn ($q) => $q->whereHas('onlineOrder', fn ($o) => $o->where('fulfilment', $request->input('channel'))))
            ->latest('id')
            ->paginate($this->perPage($request));

        return SaleResource::collection($sales);
    }

    /**
     * Checkout.
     *
     * Send an `Idempotency-Key` header (8-100 chars, unique per sale attempt). Retrying with the same
     * key and body returns the original sale with HTTP 200 and `Idempotent-Replayed: true`; the same key
     * with a different body returns 409. Requires `sales.create` at the register's branch and an open
     * shift on the register.
     */
    public function store(CheckoutRequest $request, Tenant $tenant, CheckoutService $checkout, ReceiptBuilder $receipts): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];

        ['sale' => $sale, 'replayed' => $replayed] = $checkout->checkout($tenant, $request->user(), $data, $key);
        $sale->load(['items', 'payments', 'cashier:id,name', 'customer']);

        return response()
            ->json([
                'data' => new SaleResource($sale),
                'receipt' => $receipts->build($sale),
            ], $replayed ? 200 : 201)
            ->header('Idempotent-Replayed', $replayed ? 'true' : 'false');
    }

    /**
     * Price a cart (no sale is created).
     *
     * Returns the server-computed totals, VAT breakdown and per-line stock availability so the POS can
     * show the amount due before payment. Same permissions and discount rules as checkout.
     */
    public function quote(QuoteRequest $request, Tenant $tenant, CheckoutService $checkout): JsonResponse
    {
        return response()->json(['data' => $checkout->quote($tenant, $request->validated())]);
    }

    public function show(Tenant $tenant, Sale $sale): SaleResource
    {
        $this->authorize('view', $sale);

        return new SaleResource($sale->load(['items', 'payments', 'cashier:id,name', 'customer', 'onlineOrder:id,sale_id,order_number,fulfilment,rider_name,delivery_address']));
    }

    /** Receipt data for printing or reprinting. */
    public function receipt(Tenant $tenant, Sale $sale, ReceiptBuilder $receipts): JsonResponse
    {
        $this->authorize('view', $sale);

        return response()->json(['data' => $receipts->build($sale->load(['items', 'payments', 'cashier:id,name', 'customer']), reprint: true)]);
    }

    /** Void a sale within its open shift. Requires `sales.void`. */
    public function void(Request $request, Tenant $tenant, Sale $sale, SaleVoidService $voids): SaleResource
    {
        $this->authorize('void', $sale);

        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);

        return new SaleResource($voids->void($sale, $data['reason'], $request->user()->id)->load(['items', 'payments']));
    }

    /**
     * Payment records.
     *
     * Filters: `method`, `date_from`, `date_to` (business date), `branch_id`. Requires `sales.view_all`.
     */
    public function payments(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::SALES_VIEW_ALL);

        $payments = $tenant->sales()->getQuery()
            ->join('payments', 'payments.sale_id', '=', 'sales.id')
            ->when(! $this->tenantContext()->hasAllBranches(), fn ($q) => $q->whereIn('sales.branch_id', $this->tenantContext()->branchIds()))
            ->when($request->filled('method'), fn ($q) => $q->where('payments.method', $request->string('method')))
            ->when($request->filled('branch_id'), fn ($q) => $q->where('sales.branch_id', $request->integer('branch_id')))
            ->when($request->filled('date_from'), fn ($q) => $q->where('sales.business_date', '>=', $request->string('date_from')))
            ->when($request->filled('date_to'), fn ($q) => $q->where('sales.business_date', '<=', $request->string('date_to')))
            ->orderByDesc('payments.id')
            ->select([
                'payments.id', 'payments.sale_id', 'sales.receipt_number', 'sales.branch_id', 'sales.business_date',
                'payments.method', 'payments.amount', 'payments.tendered', 'payments.reference_number', 'payments.status', 'payments.created_at',
            ])
            ->paginate($this->perPage($request, 50));

        return response()->json($payments->through(fn ($p) => [
            'id' => $p->id,
            'sale_id' => $p->sale_id,
            'receipt_number' => $p->receipt_number,
            'branch_id' => $p->branch_id,
            'business_date' => $p->business_date instanceof \DateTimeInterface ? $p->business_date->format('Y-m-d') : $p->business_date,
            'method' => $p->method,
            'amount' => $p->amount,
            'tendered' => $p->tendered,
            'reference_number' => $p->reference_number,
            'status' => $p->status,
            'created_at' => $p->created_at,
        ]));
    }
}
