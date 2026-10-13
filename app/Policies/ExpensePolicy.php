<?php

namespace App\Policies;

use App\Models\Expense;
use App\Models\User;
use App\Support\Permissions;

/** Business-wide expenses (no branch) are only visible to members with access to all branches. */
class ExpensePolicy extends TenantScopedPolicy
{
    public function view(User $user, Expense $expense): bool
    {
        return $this->allowsFor($expense, Permissions::EXPENSES_VIEW) && $this->branchVisible($expense);
    }

    public function update(User $user, Expense $expense): bool
    {
        return $this->allowsFor($expense, Permissions::EXPENSES_MANAGE) && $this->branchVisible($expense);
    }

    public function delete(User $user, Expense $expense): bool
    {
        return $this->update($user, $expense);
    }

    private function branchVisible(Expense $expense): bool
    {
        return $expense->branch_id === null
            ? $this->context()->hasAllBranches()
            : $this->context()->canAccessBranch($expense->branch_id);
    }
}
