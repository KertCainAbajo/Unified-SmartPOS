<?php

namespace App\Http\Controllers\Api\V1\Purchasing;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\GoodsReceipt;
use App\Models\PurchaseOrder;
use App\Models\Tenant;
use App\Services\Purchasing\GoodsReceiptService;
use App\Services\Purchasing\PurchaseOrderService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Purchase orders and goods receiving.
 *
 * @tags Purchasing
 */
class PurchaseOrderController extends Controller
{
    public function __construct(private readonly PurchaseOrderService $orders) {}

    /** Filters: `status`, `supplier_id`, `branch_id`. Requires `purchasing.view`. */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('viewAny', PurchaseOrder::class);

        $orders = $this->scopeToAccessibleBranches($tenant->purchaseOrders())
            ->with('supplier:id,name')
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('supplier_id'), fn ($q) => $q->where('supplier_id', $request->integer('supplier_id')))
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->latest('id')
            ->paginate($this->perPage($request));

        return response()->json($orders->through(fn (PurchaseOrder $o) => $this->present($o)));
    }

    /** Create a draft PO. Requires `purchasing.manage` at the delivery branch. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::PURCHASING_MANAGE);
        $data = $this->validated($request, $tenant);
        $this->authorizeAtBranch(Permissions::PURCHASING_MANAGE, $data['branch_id']);

        $order = $this->orders->create(Branch::query()->findOrFail($data['branch_id']), $data, $request->user()->id);

        return response()->json(['data' => $this->present($order->load(['items.product', 'supplier']))], 201);
    }

    public function show(Tenant $tenant, PurchaseOrder $purchaseOrder): JsonResponse
    {
        $this->authorize('view', $purchaseOrder);

        return response()->json(['data' => $this->present($purchaseOrder->load(['items.product', 'supplier', 'receipts']))]);
    }

    /** Edit a draft PO (items are replaced when sent). */
    public function update(Request $request, Tenant $tenant, PurchaseOrder $purchaseOrder): JsonResponse
    {
        $this->authorize('update', $purchaseOrder);
        $data = $this->validated($request, $tenant, true);

        return response()->json(['data' => $this->present($this->orders->update($purchaseOrder, $data)->load(['items.product', 'supplier']))]);
    }

    /** Mark a draft PO as sent to the supplier. */
    public function order(Tenant $tenant, PurchaseOrder $purchaseOrder): JsonResponse
    {
        $this->authorize('update', $purchaseOrder);

        return response()->json(['data' => $this->present($this->orders->markOrdered($purchaseOrder)->load('items.product'))]);
    }

    public function cancel(Request $request, Tenant $tenant, PurchaseOrder $purchaseOrder): JsonResponse
    {
        $this->authorize('update', $purchaseOrder);
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(['data' => $this->present($this->orders->cancel($purchaseOrder, $data['reason'] ?? null))]);
    }

    /**
     * Close a partially received PO short when the rest will not arrive. Received stock is kept; the
     * undelivered quantities are recorded in the audit log. Requires `purchasing.manage`.
     */
    public function close(Request $request, Tenant $tenant, PurchaseOrder $purchaseOrder): JsonResponse
    {
        $this->authorize('update', $purchaseOrder);
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);

        return response()->json(['data' => $this->present($this->orders->close($purchaseOrder, $data['reason'])->load(['items.product', 'supplier']))]);
    }

    /** Goods receipts. Filters: `purchase_order_id`, `branch_id`. Requires `purchasing.view`. */
    public function receipts(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::PURCHASING_VIEW);

        $receipts = $this->scopeToAccessibleBranches($tenant->goodsReceipts())
            ->with(['items', 'supplier:id,name'])
            ->when($request->filled('purchase_order_id'), fn ($q) => $q->where('purchase_order_id', $request->integer('purchase_order_id')))
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->latest('id')
            ->paginate($this->perPage($request));

        return response()->json($receipts->through(fn (GoodsReceipt $r) => $this->presentReceipt($r)));
    }

    public function showReceipt(Tenant $tenant, GoodsReceipt $goodsReceipt): JsonResponse
    {
        $this->authorize('view', $goodsReceipt);

        return response()->json(['data' => $this->presentReceipt($goodsReceipt->load(['items', 'supplier:id,name']))]);
    }

    /**
     * Receive goods (with or without a PO).
     *
     * With `purchase_order_id`, each item references `purchase_order_item_id` and cannot exceed the outstanding
     * quantity; `unit_cost` defaults to the PO cost. Requires `purchasing.receive` at the branch.
     */
    public function receive(Request $request, Tenant $tenant, GoodsReceiptService $service): JsonResponse
    {
        $this->authorizePermission(Permissions::PURCHASING_RECEIVE);

        $data = $request->validate([
            'branch_id' => ['required', 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)],
            'purchase_order_id' => ['nullable', 'integer', Rule::exists('purchase_orders', 'id')->where('tenant_id', $tenant->id)],
            'supplier_id' => ['nullable', 'integer', Rule::exists('suppliers', 'id')->where('tenant_id', $tenant->id)],
            'supplier_invoice_number' => ['nullable', 'string', 'max:64'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'items' => ['required', 'array', 'min:1', 'max:500'],
            'items.*.purchase_order_item_id' => ['required_with:purchase_order_id', 'nullable', 'integer', 'distinct'],
            'items.*.product_id' => ['required_without:purchase_order_id', 'nullable', 'integer', Rule::exists('products', 'id')->where('tenant_id', $tenant->id)],
            'items.*.quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0', 'max:999999999'],
            'items.*.unit_cost' => ['nullable', 'numeric', 'decimal:0,4', 'min:0', 'max:999999999'],
        ]);
        $this->authorizeAtBranch(Permissions::PURCHASING_RECEIVE, $data['branch_id']);

        $receipt = $service->receive(Branch::query()->findOrFail($data['branch_id']), $data, $request->user()->id);

        return response()->json(['data' => $this->presentReceipt($receipt->load(['items', 'supplier:id,name']))], 201);
    }

    private function validated(Request $request, Tenant $tenant, bool $updating = false): array
    {
        $required = $updating ? 'sometimes' : 'required';

        return $request->validate([
            'branch_id' => [$updating ? 'prohibited' : 'required', 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)->where('is_active', true)],
            'supplier_id' => [$required, 'integer', Rule::exists('suppliers', 'id')->where('tenant_id', $tenant->id)->where('is_active', true)],
            'order_date' => ['sometimes', 'date_format:Y-m-d'],
            'expected_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'items' => [$required, 'array', 'min:1', 'max:500'],
            'items.*.product_id' => ['required', 'integer', 'distinct', Rule::exists('products', 'id')->where('tenant_id', $tenant->id)],
            'items.*.quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0', 'max:999999999'],
            'items.*.unit_cost' => ['required', 'numeric', 'decimal:0,4', 'min:0', 'max:999999999'],
        ]);
    }

    private function present(PurchaseOrder $order): array
    {
        return [
            'id' => $order->id,
            'reference' => $order->reference,
            'status' => $order->status,
            'branch_id' => $order->branch_id,
            'supplier' => $order->relationLoaded('supplier') ? $order->supplier?->only(['id', 'name']) : null,
            'supplier_id' => $order->supplier_id,
            'order_date' => $order->order_date?->toDateString(),
            'expected_date' => $order->expected_date?->toDateString(),
            'total' => $order->total,
            'notes' => $order->notes,
            'items' => $order->relationLoaded('items') ? $order->items->map(fn ($i) => [
                'id' => $i->id,
                'product_id' => $i->product_id,
                'product' => $i->relationLoaded('product') ? $i->product->only(['id', 'sku', 'name', 'unit']) : null,
                'quantity_ordered' => $i->quantity_ordered,
                'quantity_received' => $i->quantity_received,
                'unit_cost' => $i->unit_cost,
                'line_total' => $i->line_total,
            ]) : null,
            'receipts' => $order->relationLoaded('receipts') ? $order->receipts->map->only(['id', 'reference', 'received_at', 'total_cost']) : null,
            'created_by' => $order->created_by,
            'ordered_at' => $order->ordered_at,
            'created_at' => $order->created_at,
        ];
    }

    private function presentReceipt(GoodsReceipt $receipt): array
    {
        return [
            'id' => $receipt->id,
            'reference' => $receipt->reference,
            'branch_id' => $receipt->branch_id,
            'purchase_order_id' => $receipt->purchase_order_id,
            'supplier' => $receipt->supplier?->only(['id', 'name']),
            'supplier_invoice_number' => $receipt->supplier_invoice_number,
            'received_at' => $receipt->received_at,
            'total_cost' => $receipt->total_cost,
            'notes' => $receipt->notes,
            'received_by' => $receipt->received_by,
            'items' => $receipt->items->map(fn ($i) => $i->only(['id', 'purchase_order_item_id', 'product_id', 'quantity', 'unit_cost', 'line_total'])),
        ];
    }
}
