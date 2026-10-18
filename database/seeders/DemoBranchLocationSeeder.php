<?php

namespace Database\Seeders;

use App\Models\Branch;
use Illuminate\Database\Seeder;

/**
 * DEVELOPMENT DEMO DATA ONLY. Puts the demo branches on the map so delivery tracking has a store to start from.
 * Only fills branches that have no location yet; real stores set theirs in Settings → Branches.
 */
class DemoBranchLocationSeeder extends Seeder
{
    /** @var array<string, array{float, float}> branch code => [latitude, longitude] */
    private const LOCATIONS = [
        'MAIN' => [14.6507, 121.0494], // Quezon City
        'MKT' => [14.5547, 121.0244],  // Ayala Ave., Makati
        'DVO' => [7.0866, 125.6107],   // Garcia Heights, Davao City
    ];

    public function run(): void
    {
        $updated = 0;
        foreach (self::LOCATIONS as $code => [$lat, $lng]) {
            $updated += Branch::query()->where('code', $code)->whereNull('latitude')->update(['latitude' => $lat, 'longitude' => $lng]);
        }
        $this->command?->info("Placed {$updated} demo branches on the map.");
    }
}
