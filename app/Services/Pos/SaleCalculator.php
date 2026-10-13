<?php

namespace App\Services\Pos;

use App\Enums\LineDiscountType;
use App\Enums\SaleDiscountType;
use App\Enums\TaxType;
use App\Exceptions\BusinessRuleException;
use App\Models\Product;
use App\Models\Tenant;
use App\Support\Money;

/**
 * Computes authoritative line and sale totals from server-side prices.
 *
 * Rules (amounts rounded half-up to centavos per line, then summed):
 *  - gross = unit price × quantity.
 *  - Manual line discount: percent of gross, or a fixed amount not exceeding gross.
 *  - VAT-registered, VAT-inclusive prices: VAT = net × rate / (100 + rate); line total = net.
 *  - VAT-registered, VAT-exclusive prices: VAT = net × rate / 100; line total = net + VAT.
 *  - VAT-exempt / zero-rated products carry no VAT and are reported in their own buckets.
 *  - Senior Citizen / PWD (RA 9994 / RA 10754): VAT is removed from VAT-inclusive vatable prices
 *    (recorded as vat_exemption_amount), then the statutory discount (20%) applies to the
 *    VAT-exclusive amount; the line is reported as VAT-exempt. Cannot be combined with manual discounts.
 *  - Non-VAT-registered businesses: no VAT and no VAT buckets.
 */
class SaleCalculator
{
    public function __construct(
        private readonly bool $vatRegistered,
        private readonly string $vatRate,
        private readonly bool $pricesIncludeVat,
        private readonly string $scPwdRate = '20',
    ) {}

    public static function forTenant(Tenant $tenant): self
    {
        return new self(
            (bool) $tenant->vat_registered,
            (string) $tenant->vat_rate,
            (bool) $tenant->prices_include_vat,
            (string) config('smartpos.sc_pwd_discount_rate', '20'),
        );
    }

    /**
     * @param  list<array{product: Product, quantity: string, discount_type?: LineDiscountType, discount_value?: string}>  $lines
     * @return array{lines: list<array<string, mixed>>, totals: array<string, string>}
     */
    public function calculate(array $lines, SaleDiscountType $saleDiscount = SaleDiscountType::None): array
    {
        $totals = array_fill_keys([
            'subtotal', 'discount_total', 'vat_exemption_amount', 'vatable_sales', 'vat_exempt_sales',
            'zero_rated_sales', 'vat_amount', 'total',
        ], '0');

        $results = [];
        foreach ($lines as $index => $line) {
            $result = $saleDiscount === SaleDiscountType::None
                ? $this->regularLine($line, $index)
                : $this->statutoryDiscountLine($line);

            foreach (['gross_amount' => 'subtotal', 'discount_amount' => 'discount_total',
                'vat_exemption_amount' => 'vat_exemption_amount', 'vat_amount' => 'vat_amount', 'line_total' => 'total'] as $from => $to) {
                $totals[$to] = Money::add($totals[$to], $result[$from]);
            }
            foreach ($result['buckets'] as $bucket => $amount) {
                $totals[$bucket] = Money::add($totals[$bucket], $amount);
            }
            unset($result['buckets']);
            $results[] = $result;
        }

        return [
            'lines' => $results,
            'totals' => array_map(fn (string $v) => Money::round($v), $totals),
        ];
    }

    private function regularLine(array $line, int $index): array
    {
        /** @var Product $product */
        $product = $line['product'];
        $quantity = Money::normalize($line['quantity'], 3);
        $unitPrice = Money::normalize((string) $product->price);
        $gross = Money::round(Money::mul($unitPrice, $quantity));

        $discountType = $line['discount_type'] ?? LineDiscountType::None;
        $discountValue = Money::normalize($line['discount_value'] ?? '0');
        $discount = match ($discountType) {
            LineDiscountType::None => '0.00',
            LineDiscountType::Percent => Money::round(Money::percent($gross, $discountValue)),
            LineDiscountType::Fixed => $discountValue,
        };

        if ($discountType === LineDiscountType::Percent && Money::cmp($discountValue, '100') > 0) {
            throw new BusinessRuleException('Percentage discount cannot exceed 100%.', 'INVALID_DISCOUNT',
                ["items.{$index}.discount_value" => ['Percentage discount cannot exceed 100%.']]);
        }
        if (Money::cmp($discount, $gross) > 0) {
            throw new BusinessRuleException('Discount cannot exceed the line amount.', 'INVALID_DISCOUNT',
                ["items.{$index}.discount_value" => ['Discount cannot exceed the line amount.']]);
        }

        $net = Money::round(Money::sub($gross, $discount));
        $vat = '0.00';
        $lineTotal = $net;
        $buckets = [];

        if ($this->vatRegistered) {
            switch ($product->tax_type) {
                case TaxType::Vatable:
                    if ($this->pricesIncludeVat) {
                        $vat = Money::round(Money::div(Money::mul($net, $this->vatRate), Money::add('100', $this->vatRate)));
                        $buckets['vatable_sales'] = Money::sub($net, $vat);
                    } else {
                        $vat = Money::round(Money::percent($net, $this->vatRate));
                        $lineTotal = Money::round(Money::add($net, $vat));
                        $buckets['vatable_sales'] = $net;
                    }
                    break;
                case TaxType::VatExempt:
                    $buckets['vat_exempt_sales'] = $net;
                    break;
                case TaxType::ZeroRated:
                    $buckets['zero_rated_sales'] = $net;
                    break;
            }
        }

        return $this->result($product, $quantity, $unitPrice, $gross, $discountType, $discountValue, $discount, '0.00', $vat, $lineTotal, $buckets);
    }

    private function statutoryDiscountLine(array $line): array
    {
        /** @var Product $product */
        $product = $line['product'];
        $quantity = Money::normalize($line['quantity'], 3);
        $unitPrice = Money::normalize((string) $product->price);
        $gross = Money::round(Money::mul($unitPrice, $quantity));

        $base = $gross;
        $isVatableInclusive = $this->vatRegistered && $product->tax_type === TaxType::Vatable && $this->pricesIncludeVat;
        if ($isVatableInclusive) {
            $base = Money::round(Money::div($gross, Money::add('1', Money::div($this->vatRate, '100'))));
        }
        $vatExemption = Money::round(Money::sub($gross, $base));
        $discount = Money::round(Money::percent($base, $this->scPwdRate));
        $lineTotal = Money::round(Money::sub($base, $discount));

        $buckets = [];
        if ($this->vatRegistered) {
            $bucket = $product->tax_type === TaxType::ZeroRated ? 'zero_rated_sales' : 'vat_exempt_sales';
            $buckets[$bucket] = $lineTotal;
        }

        return $this->result($product, $quantity, $unitPrice, $gross, LineDiscountType::Percent, Money::normalize($this->scPwdRate),
            $discount, $vatExemption, '0.00', $lineTotal, $buckets);
    }

    private function result(
        Product $product, string $quantity, string $unitPrice, string $gross, LineDiscountType $discountType,
        string $discountValue, string $discount, string $vatExemption, string $vat, string $lineTotal, array $buckets,
    ): array {
        return [
            'product' => $product,
            'quantity' => $quantity,
            'unit_price' => $unitPrice,
            'gross_amount' => $gross,
            'discount_type' => $discountType,
            'discount_value' => $discountValue,
            'discount_amount' => Money::round($discount),
            'vat_exemption_amount' => $vatExemption,
            'vat_amount' => $vat,
            'line_total' => $lineTotal,
            'buckets' => $buckets,
        ];
    }
}
