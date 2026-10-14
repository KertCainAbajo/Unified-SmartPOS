<?php

namespace App\Http\Resources;

use App\Models\Vacancy;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Vacancy */
class VacancyResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'description' => $this->description,
            'requirements' => $this->requirements,
            'employment_type' => $this->employment_type,
            'slots' => $this->slots,
            'status' => $this->status,
            'branch' => $this->whenLoaded('branch', fn () => ['id' => $this->branch->id, 'name' => $this->branch->name]),
            'branch_id' => $this->branch_id,
            // The role is internal (what the hire receives in SmartPOS); public pages get only the title.
            'role' => $this->whenLoaded('role', fn () => ['id' => $this->role->id, 'name' => $this->role->name]),
            'role_id' => $this->role_id,
            'required_documents' => collect($this->required_documents ?? [])
                ->map(fn (string $type) => ['type' => $type, 'label' => Vacancy::DOCUMENT_TYPES[$type] ?? $type])->values(),
            'applications_count' => $this->whenCounted('applications'),
            'created_at' => $this->created_at,
        ];
    }
}
