<?php

namespace App\Http\Controllers\Api\V1\Shop;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Throwable;

/**
 * Philippine regions → provinces → cities/municipalities → barangays for address dropdowns, from the official
 * Philippine Standard Geographic Code (PSGC) list via the free psgc.gitlab.io API. Answers are cached for 30 days,
 * so customers are not slowed down or blocked by the outside service.
 *
 * Cities outside any province (Metro Manila's cities, and a few others) are offered under a grouping entry whose
 * code is "{regionCode}-independent".
 */
class AddressAreaController extends Controller
{
    private const SOURCE = 'https://psgc.gitlab.io/api';

    private const TTL_DAYS = 30;

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(['regions', 'provinces', 'cities', 'barangays'])],
            'parent' => ['required_unless:type,regions', 'nullable', 'string', 'regex:/^\d{9,10}(-independent)?$/'],
        ]);
        $parent = $data['parent'] ?? null;

        try {
            $areas = Cache::remember("ph-areas:{$data['type']}:{$parent}", now()->addDays(self::TTL_DAYS), fn () => match ($data['type']) {
                'regions' => $this->regions(),
                'provinces' => $this->provinces((string) $parent),
                'cities' => $this->cities((string) $parent),
                'barangays' => $this->list("cities-municipalities/{$parent}/barangays"),
            });
        } catch (Throwable $e) {
            report($e);

            return response()->json(['message' => 'The address list is not available right now. Please try again shortly.'], 503);
        }

        return response()->json(['data' => $areas])->header('Cache-Control', 'public, max-age=86400');
    }

    /** @return list<array{code: string, name: string}> */
    private function regions(): array
    {
        $rows = $this->fetch('regions');
        // Common names people recognise, with the official name kept as a hint.
        $areas = array_map(fn (array $r) => [
            'code' => $r['code'],
            'name' => $this->regionLabel($r),
            'hint' => $r['regionName'] ?? null,
        ], $rows);
        usort($areas, fn ($a, $b) => strnatcasecmp($a['name'], $b['name']));

        return $areas;
    }

    /** @return list<array{code: string, name: string}> */
    private function provinces(string $region): array
    {
        $provinces = $this->list("regions/{$region}/provinces");
        $independent = array_filter($this->fetch("regions/{$region}/cities-municipalities"), fn (array $c) => empty($c['provinceCode']));
        if ($independent) {
            array_unshift($provinces, ['code' => "{$region}-independent", 'name' => $region === '130000000' ? 'Metro Manila' : 'Independent cities']);
        }

        return $provinces;
    }

    /** @return list<array{code: string, name: string}> */
    private function cities(string $parent): array
    {
        if (str_ends_with($parent, '-independent')) {
            $region = Str::before($parent, '-');
            $rows = array_values(array_filter($this->fetch("regions/{$region}/cities-municipalities"), fn (array $c) => empty($c['provinceCode'])));

            return $this->normalise($rows);
        }

        return $this->list("provinces/{$parent}/cities-municipalities");
    }

    /** @return list<array{code: string, name: string}> */
    private function list(string $path): array
    {
        return $this->normalise($this->fetch($path));
    }

    /** @return list<array<string, mixed>> */
    private function fetch(string $path): array
    {
        return Http::timeout(15)->retry(2, 300)->acceptJson()->get(self::SOURCE."/{$path}/")->throw()->json();
    }

    /** @param  list<array<string, mixed>>  $rows */
    private function normalise(array $rows): array
    {
        $areas = array_map(fn (array $r) => ['code' => (string) $r['code'], 'name' => $this->placeName((string) $r['name'])], $rows);
        usort($areas, fn ($a, $b) => strnatcasecmp($a['name'], $b['name']));

        return $areas;
    }

    /** "City of Davao" → "Davao City", the way people write addresses. */
    private function placeName(string $name): string
    {
        if (preg_match('/^(Island Garden )?City of (.+)$/i', $name, $m)) {
            $name = trim($m[2]).' City';
        }

        // "Davao Del Sur" → "Davao del Sur": Spanish particles are lower case except as the first word.
        return preg_replace_callback('/(?<=\s)(Del|De|De La|Delos|De Los)(?=\s)/', fn ($m) => mb_strtolower($m[1]), $name);
    }

    private function regionLabel(array $region): string
    {
        $short = $region['name'] ?? '';
        $long = $region['regionName'] ?? '';
        $named = ['NCR' => 'Metro Manila (NCR)', 'CAR' => 'Cordillera (CAR)', 'BARMM' => 'Bangsamoro (BARMM)'];

        return $named[$short] ?? ($long && $long !== $short ? "{$short} ({$long})" : $short);
    }
}
