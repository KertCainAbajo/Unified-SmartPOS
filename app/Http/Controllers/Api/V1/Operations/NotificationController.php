<?php

namespace App\Http\Controllers\Api\V1\Operations;

use App\Http\Controllers\Controller;
use App\Models\AppNotification;
use App\Models\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The caller's own in-app notifications for this business.
 *
 * @tags Notifications
 */
class NotificationController extends Controller
{
    /** Filter `unread=1` for unread only. */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $notifications = $tenant->notifications()
            ->where('user_id', $request->user()->id)
            ->when($request->boolean('unread'), fn ($q) => $q->whereNull('read_at'))
            ->latest('id')
            ->paginate($this->perPage($request));

        return response()->json($notifications->through(fn (AppNotification $n) => [
            'id' => $n->id,
            'type' => $n->type,
            'title' => $n->title,
            'body' => $n->body,
            'data' => $n->data,
            'read_at' => $n->read_at,
            'created_at' => $n->created_at,
        ]));
    }

    public function markRead(Request $request, Tenant $tenant, AppNotification $notification): JsonResponse
    {
        abort_unless($notification->user_id === $request->user()->id, 404, 'Resource not found.');

        $notification->forceFill(['read_at' => $notification->read_at ?? now()])->save();

        return response()->json(['id' => $notification->id, 'read_at' => $notification->read_at]);
    }

    public function markAllRead(Request $request, Tenant $tenant): JsonResponse
    {
        $count = $tenant->notifications()
            ->where('user_id', $request->user()->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return response()->json(['updated' => $count]);
    }
}
