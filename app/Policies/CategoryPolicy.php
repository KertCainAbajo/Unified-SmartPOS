<?php

namespace App\Policies;

use App\Models\Category;
use App\Models\User;
use App\Support\Permissions;

class CategoryPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::PRODUCTS_VIEW);
    }

    public function view(User $user, Category $category): bool
    {
        return $this->allowsFor($category, Permissions::PRODUCTS_VIEW);
    }

    public function create(User $user): bool
    {
        return $this->allows(Permissions::CATEGORIES_MANAGE);
    }

    public function update(User $user, Category $category): bool
    {
        return $this->allowsFor($category, Permissions::CATEGORIES_MANAGE);
    }

    public function delete(User $user, Category $category): bool
    {
        return $this->update($user, $category);
    }
}
