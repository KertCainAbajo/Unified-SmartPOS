<?php

namespace App\Http\Controllers\Api\V1\Operations;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Tenant;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * @tags Customers
 */
class CustomerController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Search by `q` (name, phone, email). Requires `customers.view`. */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('viewAny', Customer::class);

        $customers = $tenant->customers()
            ->when(! $request->boolean('include_inactive'), fn ($q) => $q->where('is_active', true))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->string('q')).'%';
                $q->where(fn ($w) => $w->where('name', 'like', $term)->orWhere('phone', 'like', $term)->orWhere('email', 'like', $term));
            })
            ->orderBy('name')
            ->paginate($this->perPage($request));

        return response()->json($customers->through(fn (Customer $c) => $this->present($c)));
    }

    /** Requires `customers.manage`. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('create', Customer::class);

        $customer = $tenant->customers()->create($this->validated($request));
        $this->audit->log('customer.created', $customer, null, $customer->only(['name']));

        return response()->json(['data' => $this->present($customer)], 201);
    }

    /** Includes purchase totals visible to members with `sales.view_all`. */
    public function show(Tenant $tenant, Customer $customer): JsonResponse
    {
        $this->authorize('view', $customer);

        $data = $this->present($customer);
        if ($this->tenantContext()->can('sales.view_all')) {
            $data['purchases'] = [
                'count' => $customer->sales()->where('status', 'completed')->count(),
                'total' => (string) ($customer->sales()->where('status', 'completed')->sum('total') ?: '0.00'),
            ];
        }

        return response()->json(['data' => $data]);
    }

    /** Update or deactivate. Customers are not deleted because sales reference them. */
    public function update(Request $request, Tenant $tenant, Customer $customer): JsonResponse
    {
        $this->authorize('update', $customer);

        $original = $customer->getOriginal();
        $customer->fill($this->validated($request, true))->save();
        $this->audit->logChanges('customer.updated', $customer, $original);

        return response()->json(['data' => $this->present($customer)]);
    }

    private function validated(Request $request, bool $updating = false): array
    {
        return $request->validate([
            'name' => [$updating ? 'sometimes' : 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'tin' => ['sometimes', 'nullable', 'string', 'max:30'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function present(Customer $customer): array
    {
        return $customer->only(['id', 'name', 'email', 'phone', 'tin', 'address', 'notes', 'is_active', 'created_at']);
    }
}
