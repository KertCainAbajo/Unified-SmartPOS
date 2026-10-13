<?php

namespace Tests\Unit;

use App\Support\Money;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class MoneyTest extends TestCase
{
    public function test_rounds_half_away_from_zero(): void
    {
        $this->assertSame('1.01', Money::round('1.005'));
        $this->assertSame('1.00', Money::round('1.0049999'));
        $this->assertSame('-1.01', Money::round('-1.005'));
        $this->assertSame('0.00', Money::round('-0.001'));
        $this->assertSame('2.346', Money::round('2.3455', 3));
    }

    public function test_avoids_floating_point_error(): void
    {
        // 0.1 + 0.2 != 0.3 in floating point.
        $this->assertSame('0.30', Money::round(Money::add('0.1', '0.2')));
        $this->assertSame('3.30', Money::round(Money::mul('1.10', '3')));
    }

    public function test_vat_extraction_from_inclusive_price(): void
    {
        // ₱112.00 VAT-inclusive at 12% → VAT ₱12.00.
        $this->assertSame('12.00', Money::round(Money::div(Money::mul('112.00', '12'), '112')));
    }

    public function test_normalize_rejects_non_decimal_input(): void
    {
        $this->expectException(InvalidArgumentException::class);
        Money::normalize('1e5');
    }

    public function test_comparisons(): void
    {
        $this->assertTrue(Money::isZero('0.000'));
        $this->assertTrue(Money::isNegative('-0.01'));
        $this->assertSame(1, Money::cmp('10.00', '9.999'));
        $this->assertSame('5', Money::min('5', '7'));
    }
}
