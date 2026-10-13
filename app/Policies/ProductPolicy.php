<?php

namespace App\Policies;

use App\Models\Product;
use App\Models\User;
use App\Support\Permissions;

class ProductPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::PRODUCTS_VIEW);
    }

    public function view(User $user, Product $product): bool
    {
        return $this->allowsFor($product, Permissions::PRODUCTS_VIEW);
    }

    public function create(User $user): bool
    {
        return $this->allows(Permissions::PRODUCTS_MANAGE);
    }

    public function update(User $user, Product $product): bool
    {
        return $this->allowsFor($product, Permissions::PRODUCTS_MANAGE);
    }

    public function changePrice(User $user, Product $product): bool
    {
        return $this->allowsFor($product, Permissions::PRODUCTS_PRICE);
    }

    public function archive(User $user, Product $product): bool
    {
        return $this->update($user, $product);
    }
}
