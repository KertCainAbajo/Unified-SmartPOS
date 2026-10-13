<?php

namespace App\Http\Controllers\Api\V1\Inventory;

use App\Http\Controllers\Controller;
use App\Http\Resources\StockCountResource;
use App\Models\Branch;
use App\Models\StockCount;
use App\Models\Tenant;
use App\Services\Inventory\StockCountService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * @tags Stock counts
 */
class StockCountController extends Controller
{
    public function __construct(private readonly StockCountService $counts) {}

    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorizePermission(Permissions::INVENTORY_VIEW);

        $counts = $this->scopeToAccessibleBranches($tenant->stockCounts())
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->latest('id')
            ->paginate($this->perPage($request));

        return StockCountResource::collection($counts);
    }

    /** Record counted quantities as a draft. Requires `inventory.count` at the branch. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::INVENTORY_COUNT);

        $data = $request->validate([
            'branch_id' => ['required', 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)],
            'notes' => ['nullable', 'string', 'max:1000'],
            'items' => ['required', 'array', 'min:1', 'max:1000'],
            'items.*.product_id' => ['required', 'integer', 'distinct', Rule::exists('products', 'id')->where('tenant_id', $tenant->id)],
            'items.*.counted_quantity' => ['required', 'numeric', 'decimal:0,3', 'min:0', 'max:999999999'],
        ]);

        $this->authorizeAtBranch(Permissions::INVENTORY_COUNT, $data['branch_id']);

        $count = $this->counts->create(
            Branch::query()->findOrFail($data['branch_id']),
            $data['items'],
            $data['notes'] ?? null,
            $request->user()->id,
        );

        return (new StockCountResource($count->load('items.product')))->response()->setStatusCode(201);
    }

    public function show(Tenant $tenant, StockCount $stockCount): StockCountResource
    {
        $this->authorize('view', $stockCount);

        return new StockCountResource($stockCount->load('items.product'));
    }

    /** Compare with system stock and post variances to the ledger. */
    public function complete(Request $request, Tenant $tenant, StockCount $stockCount): StockCountResource
    {
        $this->authorize('complete', $stockCount);

        return new StockCountResource($this->counts->complete($stockCount, $request->user()->id)->load('items.product'));
    }

    public function cancel(Tenant $tenant, StockCount $stockCount): StockCountResource
    {
        $this->authorize('complete', $stockCount);

        return new StockCountResource($this->counts->cancel($stockCount)->load('items.product'));
    }
}
