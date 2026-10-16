<?php

namespace App\Http\Controllers\Api\V1\Inventory;

use App\Http\Controllers\Controller;
use App\Http\Resources\StockTransferResource;
use App\Models\Branch;
use App\Models\StockTransfer;
use App\Models\Tenant;
use App\Services\Inventory\StockTransferService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * @tags Stock transfers
 */
class StockTransferController extends Controller
{
    public function __construct(private readonly StockTransferService $transfers) {}

    /** Transfers touching an authorized branch. Filter by `status`. */
    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorize('viewAny', StockTransfer::class);
        $branchIds = $this->tenantContext()->branchIds();

        $transfers = $tenant->stockTransfers()
            ->when($branchIds !== null, fn ($q) => $q->where(fn ($w) => $w->whereIn('from_branch_id', $branchIds)->orWhereIn('to_branch_id', $branchIds)))
            ->when($request->filled('branch_id'), fn ($q) => $q->where(fn ($w) => $w->where('from_branch_id', $request->integer('branch_id'))->orWhere('to_branch_id', $request->integer('branch_id'))))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->latest('id')
            ->paginate($this->perPage($request));

        return StockTransferResource::collection($transfers);
    }

    /** Create a draft transfer. Requires `inventory.transfer` at the source branch. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::INVENTORY_TRANSFER);

        $branchRule = Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)->where('is_active', true);
        $data = $request->validate([
            'from_branch_id' => ['required', 'integer', $branchRule],
            'to_branch_id' => ['required', 'integer', 'different:from_branch_id', $branchRule],
            'notes' => ['nullable', 'string', 'max:1000'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'integer', 'distinct', Rule::exists('products', 'id')->where('tenant_id', $tenant->id)],
            'items.*.quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0', 'max:999999999'],
        ]);

        $this->authorizeAtBranch(Permissions::INVENTORY_TRANSFER, $data['from_branch_id']);

        $transfer = $this->transfers->create(
            Branch::query()->findOrFail($data['from_branch_id']),
            Branch::query()->findOrFail($data['to_branch_id']),
            $data['items'],
            $data['notes'] ?? null,
            $request->user()->id,
        );

        return (new StockTransferResource($transfer->load('items.product')))->response()->setStatusCode(201);
    }

    public function show(Tenant $tenant, StockTransfer $stockTransfer): StockTransferResource
    {
        $this->authorize('view', $stockTransfer);

        return new StockTransferResource($stockTransfer->load('items.product'));
    }

    /** Deduct stock from the source branch and mark in transit. */
    public function dispatch(Request $request, Tenant $tenant, StockTransfer $stockTransfer): StockTransferResource
    {
        $this->authorize('dispatch', $stockTransfer);

        return new StockTransferResource($this->transfers->dispatch($stockTransfer, $request->user()->id)->load('items.product'));
    }

    /** Add stock to the destination branch. Requires `inventory.transfer` at the destination. */
    public function receive(Request $request, Tenant $tenant, StockTransfer $stockTransfer): StockTransferResource
    {
        $this->authorize('receive', $stockTransfer);

        return new StockTransferResource($this->transfers->receive($stockTransfer, $request->user()->id)->load('items.product'));
    }

    /** Cancel a draft, or an in-transit transfer (dispatched stock returns to the source branch). */
    public function cancel(Request $request, Tenant $tenant, StockTransfer $stockTransfer): StockTransferResource
    {
        $this->authorize('dispatch', $stockTransfer);

        return new StockTransferResource($this->transfers->cancel($stockTransfer, $request->user()->id)->load('items.product'));
    }
}
