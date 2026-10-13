<?php

namespace App\Enums;

enum StockMovementType: string
{
    case Opening = 'opening';
    case Adjustment = 'adjustment';
    case Sale = 'sale';
    case SaleVoid = 'sale_void';
    case Refund = 'refund';
    case PurchaseReceipt = 'purchase_receipt';
    case TransferOut = 'transfer_out';
    case TransferIn = 'transfer_in';
    case StockCount = 'stock_count';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
