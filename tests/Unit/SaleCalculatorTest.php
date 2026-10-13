<?php

namespace Tests\Unit;

use App\Enums\LineDiscountType;
use App\Enums\SaleDiscountType;
use App\Enums\TaxType;
use App\Exceptions\BusinessRuleException;
use App\Models\Product;
use App\Services\Pos\SaleCalculator;
use PHPUnit\Framework\TestCase;

class SaleCalculatorTest extends TestCase
{
    private function product(string $price, TaxType $tax = TaxType::Vatable): Product
    {
        return (new Product)->forceFill(['id' => random_int(1, 100000), 'price' => $price, 'tax_type' => $tax, 'sku' => 'X', 'name' => 'X']);
    }

    private function line(Product $product, string $qty, LineDiscountType $type = LineDiscountType::None, string $value = '0'): array
    {
        return ['product' => $product, 'quantity' => $qty, 'discount_type' => $type, 'discount_value' => $value];
    }

    public function test_vat_inclusive_pricing_extracts_vat(): void
    {
        $calc = new SaleCalculator(true, '12.00', true);
        $result = $calc->calculate([$this->line($this->product('112.00'), '2')]);

        $this->assertSame([
            'subtotal' => '224.00',
            'discount_total' => '0.00',
            'vat_exemption_amount' => '0.00',
            'vatable_sales' => '200.00',
            'vat_exempt_sales' => '0.00',
            'zero_rated_sales' => '0.00',
            'vat_amount' => '24.00',
            'total' => '224.00',
        ], $result['totals']);
    }

    public function test_vat_exclusive_pricing_adds_vat(): void
    {
        $result = (new SaleCalculator(true, '12.00', false))->calculate([$this->line($this->product('100.00'), '1')]);

        $this->assertSame('100.00', $result['totals']['vatable_sales']);
        $this->assertSame('12.00', $result['totals']['vat_amount']);
        $this->assertSame('112.00', $result['totals']['total']);
    }

    public function test_mixed_tax_types_go_to_separate_buckets(): void
    {
        $result = (new SaleCalculator(true, '12.00', true))->calculate([
            $this->line($this->product('56.00'), '1'),
            $this->line($this->product('30.00', TaxType::VatExempt), '2'),
            $this->line($this->product('10.00', TaxType::ZeroRated), '1'),
        ]);

        $this->assertSame('50.00', $result['totals']['vatable_sales']);
        $this->assertSame('6.00', $result['totals']['vat_amount']);
        $this->assertSame('60.00', $result['totals']['vat_exempt_sales']);
        $this->assertSame('10.00', $result['totals']['zero_rated_sales']);
        $this->assertSame('126.00', $result['totals']['total']);
    }

    public function test_line_discounts(): void
    {
        $result = (new SaleCalculator(true, '12.00', true))->calculate([
            $this->line($this->product('112.00'), '2', LineDiscountType::Percent, '10'),
            $this->line($this->product('50.00'), '1', LineDiscountType::Fixed, '5.50'),
        ]);

        $this->assertSame('27.90', $result['totals']['discount_total']); // 22.40 + 5.50
        $this->assertSame('246.10', $result['totals']['total']);           // 201.60 + 44.50
        $this->assertSame('26.37', $result['totals']['vat_amount']);       // 21.60 + 4.77
    }

    public function test_discount_cannot_exceed_line_amount(): void
    {
        $this->expectException(BusinessRuleException::class);
        (new SaleCalculator(true, '12.00', true))->calculate([$this->line($this->product('10.00'), '1', LineDiscountType::Fixed, '10.01')]);
    }

    public function test_senior_citizen_discount_removes_vat_then_applies_twenty_percent(): void
    {
        $result = (new SaleCalculator(true, '12.00', true))->calculate(
            [$this->line($this->product('112.00'), '1')],
            SaleDiscountType::SeniorCitizen,
        );

        $this->assertSame('112.00', $result['totals']['subtotal']);
        $this->assertSame('12.00', $result['totals']['vat_exemption_amount']);
        $this->assertSame('20.00', $result['totals']['discount_total']);
        $this->assertSame('0.00', $result['totals']['vat_amount']);
        $this->assertSame('80.00', $result['totals']['vat_exempt_sales']);
        $this->assertSame('80.00', $result['totals']['total']);
    }

    public function test_non_vat_registered_business_has_no_vat(): void
    {
        $result = (new SaleCalculator(false, '12.00', true))->calculate([$this->line($this->product('100.00'), '3')]);

        $this->assertSame('0.00', $result['totals']['vat_amount']);
        $this->assertSame('0.00', $result['totals']['vatable_sales']);
        $this->assertSame('300.00', $result['totals']['total']);
    }

    public function test_decimal_quantities_round_per_line(): void
    {
        $result = (new SaleCalculator(true, '12.00', true))->calculate([$this->line($this->product('99.99'), '1.235')]);

        $this->assertSame('123.49', $result['totals']['total']); // 123.48765 → 123.49
    }
}
