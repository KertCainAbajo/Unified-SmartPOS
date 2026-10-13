<?php

namespace App\Http\Resources;

use App\Models\RegisterSession;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin RegisterSession */
class RegisterSessionResource extends JsonResource
{
    /** @var array<string, mixed>|null */
    public ?array $summary = null;

    public function withSummary(array $summary): static
    {
        $this->summary = $summary;

        return $this;
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'register_id' => $this->register_id,
            'status' => $this->status,
            'opened_by' => $this->opened_by,
            'closed_by' => $this->closed_by,
            'opening_float' => $this->opening_float,
            'cash_sales' => $this->cash_sales,
            'cash_refunds' => $this->cash_refunds,
            'expected_cash' => $this->expected_cash,
            'counted_cash' => $this->counted_cash,
            'cash_difference' => $this->cash_difference,
            'opened_at' => $this->opened_at,
            'closed_at' => $this->closed_at,
            'notes' => $this->notes,
            'summary' => $this->when($this->summary !== null, fn () => $this->summary),
        ];
    }
}
