<?php

namespace App\Http\Controllers\Api\V1\Catalog;

use App\Enums\ProductStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Catalog\ProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Catalog\ProductImageService;
use App\Services\Catalog\ProductService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

/**
 * @tags Products
 */
class ProductController extends Controller
{
    public function __construct(private readonly ProductService $products, private readonly ProductImageService $images) {}

    /**
     * Search and list products.
     *
     * Filters: `q` (name, SKU or barcode), `barcode` (exact), `sku` (exact), `category_id`,
     * `status` (`active` default, `archived`, `all`). Requires `products.view`.
     */
    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Product::class);

        $status = $request->string('status', 'active')->toString();

        $products = $tenant->products()
            ->with('category')
            ->when($status !== 'all', fn ($q) => $q->where('status', $status === 'archived' ? 'archived' : 'active'))
            ->when($request->filled('barcode'), fn ($q) => $q->where('barcode', $request->string('barcode')))
            ->when($request->filled('sku'), fn ($q) => $q->where('sku', strtoupper($request->string('sku'))))
            ->when($request->filled('category_id'), fn ($q) => $q->where('category_id', $request->integer('category_id')))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->string('q')).'%';
                $q->where(fn ($w) => $w->where('name', 'like', $term)->orWhere('sku', 'like', $term)->orWhere('barcode', 'like', $term));
            })
            ->when($request->boolean('with_stock'), fn ($q) => $q->with(['inventory' => fn ($i) => $this->scopeToAccessibleBranches($i)]))
            ->orderBy('name')
            ->paginate($this->perPage($request));

        return ProductResource::collection($products);
    }

    /** Create a product. Requires `products.manage`. */
    public function store(ProductRequest $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('create', Product::class);

        $product = $this->products->create($tenant, $request->validated(), $request->user()->id);

        return (new ProductResource($product->load('category')))->response()->setStatusCode(201);
    }

    /** Product details with stock in accessible branches. */
    public function show(Tenant $tenant, Product $product): ProductResource
    {
        $this->authorize('view', $product);

        return new ProductResource($product->load(['category', 'inventory' => fn ($q) => $this->scopeToAccessibleBranches($q)]));
    }

    /** Update product details (not price). Requires `products.manage`. */
    public function update(ProductRequest $request, Tenant $tenant, Product $product): ProductResource
    {
        $this->authorize('update', $product);

        return new ProductResource($this->products->update($product, $request->validated())->load('category'));
    }

    /** Change price and/or cost. Writes price history. Requires `products.price`. */
    public function updatePrice(Request $request, Tenant $tenant, Product $product): ProductResource
    {
        $this->authorize('changePrice', $product);

        $data = $request->validate([
            'price' => ['required_without:cost_price', 'numeric', 'decimal:0,2', 'min:0', 'max:999999999'],
            'cost_price' => ['required_without:price', 'numeric', 'decimal:0,4', 'min:0', 'max:999999999'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);

        $product = $this->products->changePrice(
            $product,
            isset($data['price']) ? (string) $data['price'] : null,
            isset($data['cost_price']) ? (string) $data['cost_price'] : null,
            $data['reason'] ?? null,
            $request->user()->id,
        );

        return new ProductResource($product);
    }

    /** Price and cost change history. Requires `products.view`. */
    public function priceHistory(Request $request, Tenant $tenant, Product $product): JsonResponse
    {
        $this->authorize('view', $product);
        $showCost = $this->tenantContext()->can('products.price') || $this->tenantContext()->can('reports.financial');

        $history = $product->priceHistory()->with('changedBy:id,name')->latest('id')->paginate($this->perPage($request));

        return response()->json($history->through(fn ($h) => [
            'id' => $h->id,
            'old_price' => $h->old_price,
            'new_price' => $h->new_price,
            'old_cost' => $showCost ? $h->old_cost : null,
            'new_cost' => $showCost ? $h->new_cost : null,
            'reason' => $h->reason,
            'changed_by' => $h->changedBy?->only(['id', 'name']),
            'created_at' => $h->created_at,
        ]));
    }

    /** Archive (hide from POS). Products are never hard-deleted because sales reference them. */
    public function archive(Tenant $tenant, Product $product): ProductResource
    {
        $this->authorize('archive', $product);

        return new ProductResource($product->status === ProductStatus::Archived ? $product : $this->products->archive($product));
    }

    public function restore(Tenant $tenant, Product $product): ProductResource
    {
        $this->authorize('archive', $product);

        return new ProductResource($product->status === ProductStatus::Active ? $product : $this->products->restore($product));
    }
    /** The product photo. Requires `products.view`. */
    public function image(Tenant $tenant, Product $product): Response
    {
        $this->authorize('view', $product);

        return $this->images->response($product);
    }

    /** Upload or replace the product photo (JPG, PNG or WebP, up to 5 MB). Requires `products.manage`. */
    public function uploadImage(Request $request, Tenant $tenant, Product $product): ProductResource
    {
        $this->authorize('update', $product);
        $data = $request->validate([
            'image' => ['required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:5120', 'dimensions:max_width=6000,max_height=6000'],
        ]);

        return new ProductResource($this->images->store($product, $data['image'])->load('category'));
    }

    /** Remove the product photo. Requires `products.manage`. */
    public function removeImage(Tenant $tenant, Product $product): ProductResource
    {
        $this->authorize('update', $product);

        return new ProductResource($this->images->remove($product)->load('category'));
    }
}
