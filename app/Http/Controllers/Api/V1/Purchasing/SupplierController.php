<?php

namespace App\Http\Controllers\Api\V1\Purchasing;

use App\Http\Controllers\Controller;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * @tags Suppliers
 */
class SupplierController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Filter with `q` (name/contact/email) and `active_only`. Requires `suppliers.view`. */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('viewAny', Supplier::class);

        $suppliers = $tenant->suppliers()
            ->when($request->boolean('active_only'), fn ($q) => $q->where('is_active', true))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->string('q')).'%';
                $q->where(fn ($w) => $w->whereLike('name', $term)->orWhereLike('contact_person', $term)->orWhereLike('email', $term));
            })
            ->orderBy('name')
            ->paginate($this->perPage($request));

        return response()->json($suppliers->through(fn (Supplier $s) => $this->present($s)));
    }

    /** Requires `suppliers.manage`. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('create', Supplier::class);

        $supplier = $tenant->suppliers()->create($this->validated($request));
        $this->audit->log('supplier.created', $supplier, null, $supplier->only(['name', 'tin']));

        return response()->json(['data' => $this->present($supplier)], 201);
    }

    public function show(Tenant $tenant, Supplier $supplier): JsonResponse
    {
        $this->authorize('view', $supplier);

        return response()->json(['data' => $this->present($supplier)]);
    }

    /** Update or deactivate (`is_active=false`). Suppliers are not deleted because purchase records reference them. */
    public function update(Request $request, Tenant $tenant, Supplier $supplier): JsonResponse
    {
        $this->authorize('update', $supplier);

        $original = $supplier->getOriginal();
        $supplier->fill($this->validated($request, true))->save();
        $this->audit->logChanges('supplier.updated', $supplier, $original);

        return response()->json(['data' => $this->present($supplier)]);
    }

    private function validated(Request $request, bool $updating = false): array
    {
        $required = $updating ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:255'],
            'contact_person' => ['sometimes', 'nullable', 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'tin' => ['sometimes', 'nullable', 'string', 'max:30'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function present(Supplier $supplier): array
    {
        return $supplier->only(['id', 'name', 'contact_person', 'email', 'phone', 'address', 'tin', 'is_active', 'created_at']);
    }
}
