<?php

namespace App\Http\Controllers\Api\V1\Inventory;

use App\Http\Controllers\Controller;
use App\Http\Resources\StockMovementResource;
use App\Models\Branch;
use App\Models\Tenant;
use App\Services\Inventory\StockAdjustmentService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * @tags Inventory
 */
class InventoryController extends Controller
{
    /**
     * Stock balances per branch.
     *
     * Filters: `branch_id`, `product_id`, `q` (name/SKU/barcode). Requires `inventory.view`;
     * only authorized branches are returned.
     */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::INVENTORY_VIEW);
        $request->validate(['branch_id' => ['sometimes', 'integer'], 'product_id' => ['sometimes', 'integer']]);

        $rows = $this->scopeToAccessibleBranches($tenant->inventory()->getQuery(), 'inventory.branch_id')
            ->join('products', 'products.id', '=', 'inventory.product_id')
            ->when($request->filled('branch_id'), fn ($q) => $q->where('inventory.branch_id', $request->integer('branch_id')))
            ->when($request->filled('product_id'), fn ($q) => $q->where('inventory.product_id', $request->integer('product_id')))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->string('q')).'%';
                $q->where(fn ($w) => $w->where('products.name', 'like', $term)->orWhere('products.sku', 'like', $term)->orWhere('products.barcode', 'like', $term));
            })
            ->orderBy('products.name')
            ->select([
                'inventory.id', 'inventory.branch_id', 'inventory.product_id', 'inventory.quantity',
                'inventory.reorder_level as branch_reorder_level', 'inventory.updated_at',
                'products.sku', 'products.name', 'products.unit', 'products.reorder_level',
            ])
            ->paginate($this->perPage($request));

        return response()->json($rows->through(fn ($row) => [
            'branch_id' => $row->branch_id,
            'product_id' => $row->product_id,
            'sku' => $row->sku,
            'name' => $row->name,
            'unit' => $row->unit,
            'quantity' => $row->quantity,
            'reorder_level' => $row->branch_reorder_level ?? $row->reorder_level,
            'updated_at' => $row->updated_at,
        ]));
    }

    /**
     * Products at or below their reorder level, per authorized branch.
     *
     * Includes products that have never been stocked at a branch (treated as zero).
     */
    public function lowStock(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::INVENTORY_VIEW);
        $request->validate(['branch_id' => ['sometimes', 'integer']]);

        $rows = DB::table('products')
            ->join('branches', 'branches.tenant_id', '=', 'products.tenant_id')
            ->leftJoin('inventory', fn ($j) => $j->on('inventory.product_id', '=', 'products.id')->on('inventory.branch_id', '=', 'branches.id'))
            ->where('products.tenant_id', $tenant->id)
            ->where('products.status', 'active')
            ->where('products.track_inventory', true)
            ->where('branches.is_active', true)
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branches.id', $request->integer('branch_id')))
            ->when(! $this->tenantContext()->hasAllBranches(), fn ($q) => $q->whereIn('branches.id', $this->tenantContext()->branchIds()))
            ->whereRaw('COALESCE(inventory.reorder_level, products.reorder_level) > 0')
            ->whereRaw('COALESCE(inventory.quantity, 0) <= COALESCE(inventory.reorder_level, products.reorder_level)')
            ->orderBy('branches.id')->orderBy('products.name')
            ->select([
                'branches.id as branch_id', 'branches.name as branch_name', 'products.id as product_id',
                'products.sku', 'products.name', 'products.unit',
                DB::raw('COALESCE(inventory.quantity, 0) as quantity'),
                DB::raw('COALESCE(inventory.reorder_level, products.reorder_level) as reorder_level'),
            ])
            ->paginate($this->perPage($request, 50));

        return response()->json($rows);
    }

    /**
     * Adjust stock with a reason.
     *
     * `quantity_change` is signed (e.g. `-2` for two damaged units). The resulting balance can never
     * be negative. Requires `inventory.adjust` at the branch.
     */
    public function adjust(Request $request, Tenant $tenant, StockAdjustmentService $service): JsonResponse
    {
        $this->authorizePermission(Permissions::INVENTORY_ADJUST);

        $data = $request->validate([
            'branch_id' => ['required', 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)],
            'reason' => ['required', Rule::in(StockAdjustmentService::REASONS)],
            'notes' => ['nullable', 'string', 'max:200'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'integer', 'distinct', Rule::exists('products', 'id')->where('tenant_id', $tenant->id)],
            'items.*.quantity_change' => ['required', 'numeric', 'decimal:0,3', 'not_in:0', 'between:-999999999,999999999'],
            'items.*.unit_cost' => ['nullable', 'numeric', 'decimal:0,4', 'min:0'],
        ]);

        $this->authorizeAtBranch(Permissions::INVENTORY_ADJUST, $data['branch_id']);

        $movements = $service->adjust(
            Branch::query()->findOrFail($data['branch_id']),
            $data['reason'],
            $data['notes'] ?? null,
            $data['items'],
            $request->user()->id,
        );

        return response()->json(['data' => StockMovementResource::collection($movements)], 201);
    }

    /**
     * Inventory history (stock ledger).
     *
     * Filters: `branch_id`, `product_id`, `type`, `date_from`, `date_to` (YYYY-MM-DD, tenant timezone).
     */
    public function movements(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorizePermission(Permissions::INVENTORY_VIEW);
        $request->validate([
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:date_from'],
        ]);
        $tz = $tenant->timezone;

        $movements = $this->scopeToAccessibleBranches($tenant->stockMovements())
            ->with(['product:id,sku,name,unit', 'user:id,name'])
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->when($request->filled('product_id'), fn ($q) => $q->where('product_id', $request->integer('product_id')))
            ->when($request->filled('type'), fn ($q) => $q->where('type', $request->string('type')))
            ->when($request->filled('date_from'), fn ($q) => $q->where('created_at', '>=', Carbon::parse($request->string('date_from'), $tz)->startOfDay()->utc()))
            ->when($request->filled('date_to'), fn ($q) => $q->where('created_at', '<=', Carbon::parse($request->string('date_to'), $tz)->endOfDay()->utc()))
            ->latest('id')
            ->paginate($this->perPage($request, 50));

        return StockMovementResource::collection($movements);
    }
}
