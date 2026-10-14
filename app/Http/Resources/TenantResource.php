<?php

namespace App\Http\Resources;

use App\Models\Tenant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Tenant */
class TenantResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'legal_name' => $this->legal_name,
            'tin' => $this->tin,
            'address' => $this->address,
            'phone' => $this->phone,
            'email' => $this->email,
            'staff_email_domain' => $this->staff_email_domain,
            'currency' => $this->currency,
            'timezone' => $this->timezone,
            'vat_registered' => $this->vat_registered,
            'vat_rate' => $this->vat_rate,
            'prices_include_vat' => $this->prices_include_vat,
            'allow_negative_stock' => $this->allow_negative_stock,
            'refund_approval_threshold' => $this->refund_approval_threshold,
            'refund_window_days' => $this->refund_window_days,
            'recruitment_allow_self_approval' => $this->recruitment_allow_self_approval,
            'status' => $this->status,
            'owner_user_id' => $this->owner_user_id,
            'created_at' => $this->created_at,
        ];
    }
}
