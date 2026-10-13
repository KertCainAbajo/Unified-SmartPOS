<?php

namespace App\Http\Controllers\Api\V1\Operations;

use App\Enums\PaymentMethod;
use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Tenant;
use App\Services\AuditLogger;
use App\Support\Permissions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Recorded operating expenses.
 *
 * @tags Expenses
 */
class ExpenseController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function categories(Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::EXPENSES_VIEW);

        return response()->json(['data' => $tenant->expenseCategories()->orderBy('name')->get(['id', 'name', 'is_active'])]);
    }

    public function storeCategory(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::EXPENSES_MANAGE);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('expense_categories')->where('tenant_id', $tenant->id)],
        ]);

        $category = $tenant->expenseCategories()->create($data);
        $this->audit->log('expense_category.created', $category, null, $data);

        return response()->json(['data' => $category->only(['id', 'name', 'is_active'])], 201);
    }

    public function updateCategory(Request $request, Tenant $tenant, ExpenseCategory $expenseCategory): JsonResponse
    {
        $this->authorizePermission(Permissions::EXPENSES_MANAGE);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255', Rule::unique('expense_categories')->where('tenant_id', $tenant->id)->ignore($expenseCategory->id)],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $original = $expenseCategory->getOriginal();
        $expenseCategory->fill($data)->save();
        $this->audit->logChanges('expense_category.updated', $expenseCategory, $original);

        return response()->json(['data' => $expenseCategory->only(['id', 'name', 'is_active'])]);
    }

    /** Filters: `date_from`, `date_to`, `branch_id`, `expense_category_id`. Requires `expenses.view`. */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::EXPENSES_VIEW);
        $context = $this->tenantContext();

        $expenses = $tenant->expenses()
            ->with('category:id,name')
            ->when(! $context->hasAllBranches(), fn ($q) => $q->whereIn('branch_id', $context->branchIds()))
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->when($request->filled('expense_category_id'), fn ($q) => $q->where('expense_category_id', $request->integer('expense_category_id')))
            ->when($request->filled('date_from'), fn ($q) => $q->where('expense_date', '>=', $request->string('date_from')))
            ->when($request->filled('date_to'), fn ($q) => $q->where('expense_date', '<=', $request->string('date_to')))
            ->orderByDesc('expense_date')->orderByDesc('id')
            ->paginate($this->perPage($request));

        return response()->json($expenses->through(fn (Expense $e) => $this->present($e)));
    }

    /** Record an expense. A null `branch_id` means business-wide and requires access to all branches. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::EXPENSES_MANAGE);
        $data = $this->validated($request, $tenant);
        $this->assertBranchAllowed($data['branch_id'] ?? null);

        $expense = $tenant->expenses()->make($data);
        $expense->recorded_by = $request->user()->id;
        $expense->save();
        $this->audit->log('expense.recorded', $expense, null, $expense->only(['amount', 'expense_date', 'expense_category_id', 'description']));

        return response()->json(['data' => $this->present($expense->load('category:id,name'))], 201);
    }

    public function show(Tenant $tenant, Expense $expense): JsonResponse
    {
        $this->authorize('view', $expense);

        return response()->json(['data' => $this->present($expense->load('category:id,name'))]);
    }

    public function update(Request $request, Tenant $tenant, Expense $expense): JsonResponse
    {
        $this->authorize('update', $expense);
        $data = $this->validated($request, $tenant, true);
        if (array_key_exists('branch_id', $data)) {
            $this->assertBranchAllowed($data['branch_id']);
        }

        $original = $expense->getOriginal();
        $expense->fill($data)->save();
        $this->audit->logChanges('expense.updated', $expense, $original);

        return response()->json(['data' => $this->present($expense->load('category:id,name'))]);
    }

    /** Soft-deletes; the record remains in the database and in the audit log. */
    public function destroy(Tenant $tenant, Expense $expense): JsonResponse
    {
        $this->authorize('delete', $expense);

        $expense->delete();
        $this->audit->log('expense.deleted', $expense, $expense->only(['amount', 'expense_date', 'description']));

        return response()->json(null, 204);
    }

    private function validated(Request $request, Tenant $tenant, bool $updating = false): array
    {
        $required = $updating ? 'sometimes' : 'required';

        return $request->validate([
            'branch_id' => ['sometimes', 'nullable', 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)],
            'expense_category_id' => [$required, 'integer', Rule::exists('expense_categories', 'id')->where('tenant_id', $tenant->id)],
            'amount' => [$required, 'numeric', 'decimal:0,2', 'gt:0', 'max:999999999'],
            'expense_date' => [$required, 'date_format:Y-m-d'],
            'description' => [$required, 'string', 'max:255'],
            'reference' => ['sometimes', 'nullable', 'string', 'max:100'],
            'payment_method' => ['sometimes', 'nullable', Rule::enum(PaymentMethod::class)],
        ]);
    }

    private function assertBranchAllowed(?int $branchId): void
    {
        $context = $this->tenantContext();
        $allowed = $branchId === null ? $context->hasAllBranches() : $context->canAccessBranch($branchId);

        if (! $allowed) {
            throw new AuthorizationException('You cannot record expenses for this branch.');
        }
    }

    private function present(Expense $expense): array
    {
        return [
            'id' => $expense->id,
            'branch_id' => $expense->branch_id,
            'expense_category_id' => $expense->expense_category_id,
            'category' => $expense->relationLoaded('category') ? $expense->category?->only(['id', 'name']) : null,
            'amount' => $expense->amount,
            'expense_date' => $expense->expense_date?->toDateString(),
            'description' => $expense->description,
            'reference' => $expense->reference,
            'payment_method' => $expense->payment_method,
            'recorded_by' => $expense->recorded_by,
            'created_at' => $expense->created_at,
        ];
    }
}
