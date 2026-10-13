<?php

namespace App\Http\Controllers\Api\V1\Catalog;

use App\Exceptions\BusinessRuleException;
use App\Http\Controllers\Controller;
use App\Http\Resources\CategoryResource;
use App\Models\Category;
use App\Models\Tenant;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * @tags Categories
 */
class CategoryController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Requires `products.view`. */
    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Category::class);

        $categories = $tenant->categories()
            ->withCount('products')
            ->when($request->boolean('active_only'), fn ($q) => $q->where('is_active', true))
            ->orderBy('sort_order')->orderBy('name')
            ->get();

        return CategoryResource::collection($categories);
    }

    /** Requires `categories.manage`. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('create', Category::class);

        $data = $this->validated($request, $tenant);
        $category = $tenant->categories()->create($data);
        $this->audit->log('category.created', $category, null, $data);

        return (new CategoryResource($category))->response()->setStatusCode(201);
    }

    public function show(Tenant $tenant, Category $category): CategoryResource
    {
        $this->authorize('view', $category);

        return new CategoryResource($category->loadCount('products'));
    }

    /** Requires `categories.manage`. */
    public function update(Request $request, Tenant $tenant, Category $category): CategoryResource
    {
        $this->authorize('update', $category);

        $data = $this->validated($request, $tenant, $category);
        if (($data['parent_id'] ?? null) === $category->id) {
            throw new BusinessRuleException('A category cannot be its own parent.', 'INVALID_PARENT');
        }

        $original = $category->getOriginal();
        $category->fill($data)->save();
        $this->audit->logChanges('category.updated', $category, $original);

        return new CategoryResource($category);
    }

    /** Delete an empty category. Categories with products must be deactivated instead. */
    public function destroy(Tenant $tenant, Category $category): JsonResponse
    {
        $this->authorize('delete', $category);

        if ($category->products()->exists() || $category->children()->exists()) {
            throw new BusinessRuleException('Category has products or subcategories; deactivate it instead.', 'CATEGORY_IN_USE');
        }

        $this->audit->log('category.deleted', $category, $category->only(['name', 'slug']));
        $category->delete();

        return response()->json(null, 204);
    }

    private function validated(Request $request, Tenant $tenant, ?Category $category = null): array
    {
        if ($request->filled('name') && ! $request->filled('slug')) {
            $request->merge(['slug' => Str::slug($request->string('name'))]);
        }
        $required = $category ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:255'],
            'slug' => [$required, 'string', 'max:255', 'alpha_dash',
                Rule::unique('categories')->where('tenant_id', $tenant->id)->ignore($category?->id)],
            'parent_id' => ['sometimes', 'nullable', 'integer', Rule::exists('categories', 'id')->where('tenant_id', $tenant->id)],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
        ]);
    }
}
