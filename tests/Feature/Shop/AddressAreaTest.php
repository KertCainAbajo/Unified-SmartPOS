<?php

namespace Tests\Feature\Shop;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AddressAreaTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Http::preventStrayRequests();
        Http::fake([
            'psgc.gitlab.io/api/regions/' => Http::response([
                ['code' => '130000000', 'name' => 'NCR', 'regionName' => 'National Capital Region'],
                ['code' => '110000000', 'name' => 'Davao Region', 'regionName' => 'Region XI'],
            ]),
            'psgc.gitlab.io/api/regions/130000000/provinces/' => Http::response([]),
            'psgc.gitlab.io/api/regions/130000000/cities-municipalities/' => Http::response([
                ['code' => '137404000', 'name' => 'Quezon City', 'provinceCode' => false],
                ['code' => '137602000', 'name' => 'City of Makati', 'provinceCode' => false],
            ]),
            'psgc.gitlab.io/api/cities-municipalities/137602000/barangays/' => Http::response([
                ['code' => '137602001', 'name' => 'Poblacion'], ['code' => '137602002', 'name' => 'Bel-Air'],
            ]),
        ]);
    }

    public function test_metro_manila_cities_are_grouped_and_names_read_naturally(): void
    {
        $this->getJson('/api/v1/address/areas?type=regions')->assertOk()
            ->assertJsonPath('data.0.name', 'Davao Region (Region XI)')
            ->assertJsonPath('data.1.name', 'Metro Manila (NCR)');

        $this->getJson('/api/v1/address/areas?type=provinces&parent=130000000')->assertOk()
            ->assertJsonPath('data.0', ['code' => '130000000-independent', 'name' => 'Metro Manila']);

        $this->getJson('/api/v1/address/areas?type=cities&parent=130000000-independent')->assertOk()
            ->assertJsonPath('data.0.name', 'Makati City')
            ->assertJsonPath('data.1.name', 'Quezon City');

        $this->getJson('/api/v1/address/areas?type=barangays&parent=137602000')->assertOk()->assertJsonPath('data.0.name', 'Bel-Air');
    }

    public function test_answers_are_cached_and_bad_input_is_rejected(): void
    {
        $this->getJson('/api/v1/address/areas?type=regions')->assertOk();
        $this->getJson('/api/v1/address/areas?type=regions')->assertOk();
        Http::assertSentCount(1);

        $this->getJson('/api/v1/address/areas?type=barangays')->assertUnprocessable();
        $this->getJson('/api/v1/address/areas?type=barangays&parent=../../etc')->assertUnprocessable();
    }

    public function test_an_unreachable_directory_gives_a_plain_message(): void
    {
        Http::fake(['*' => Http::response('down', 500)]);

        $this->getJson('/api/v1/address/areas?type=barangays&parent=112402000')->assertStatus(503)
            ->assertJsonPath('message', 'The address list is not available right now. Please try again shortly.');
    }
}
