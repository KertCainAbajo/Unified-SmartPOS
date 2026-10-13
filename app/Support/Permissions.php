<?php

namespace App\Support;

/**
 * Permission catalogue and system role definitions.
 *
 * Seeded by Database\Seeders\RolesAndPermissionsSeeder. Code refers to permissions by key.
 */
final class Permissions
{
    public const TENANT_MANAGE = 'tenant.manage';

    public const BRANCHES_MANAGE = 'branches.manage';

    public const MEMBERS_VIEW = 'members.view';

    public const MEMBERS_MANAGE = 'members.manage';

    public const ROLES_MANAGE = 'roles.manage';

    public const PRODUCTS_VIEW = 'products.view';

    public const PRODUCTS_MANAGE = 'products.manage';

    public const PRODUCTS_PRICE = 'products.price';

    public const CATEGORIES_MANAGE = 'categories.manage';

    public const INVENTORY_VIEW = 'inventory.view';

    public const INVENTORY_ADJUST = 'inventory.adjust';

    public const INVENTORY_TRANSFER = 'inventory.transfer';

    public const INVENTORY_COUNT = 'inventory.count';

    public const SUPPLIERS_VIEW = 'suppliers.view';

    public const SUPPLIERS_MANAGE = 'suppliers.manage';

    public const PURCHASING_VIEW = 'purchasing.view';

    public const PURCHASING_MANAGE = 'purchasing.manage';

    public const PURCHASING_RECEIVE = 'purchasing.receive';

    public const CUSTOMERS_VIEW = 'customers.view';

    public const CUSTOMERS_MANAGE = 'customers.manage';

    public const REGISTERS_MANAGE = 'registers.manage';

    public const SHIFTS_OPERATE = 'shifts.operate';

    public const SHIFTS_VIEW_ALL = 'shifts.view_all';

    public const SALES_CREATE = 'sales.create';

    public const SALES_VIEW = 'sales.view';

    public const SALES_VIEW_ALL = 'sales.view_all';

    public const SALES_DISCOUNT = 'sales.discount';

    public const SALES_VOID = 'sales.void';

    public const REFUNDS_CREATE = 'refunds.create';

    public const REFUNDS_APPROVE = 'refunds.approve';

    public const EXPENSES_VIEW = 'expenses.view';

    public const EXPENSES_MANAGE = 'expenses.manage';

    public const REPORTS_VIEW = 'reports.view';

    public const REPORTS_FINANCIAL = 'reports.financial';

    public const AUDIT_VIEW = 'audit_logs.view';

    /** @return array<string, array{name: string, group: string}> */
    public static function catalogue(): array
    {
        return [
            self::TENANT_MANAGE => ['name' => 'Manage business settings', 'group' => 'business'],
            self::BRANCHES_MANAGE => ['name' => 'Manage branches', 'group' => 'business'],
            self::MEMBERS_VIEW => ['name' => 'View team members', 'group' => 'team'],
            self::MEMBERS_MANAGE => ['name' => 'Add members and assign roles', 'group' => 'team'],
            self::ROLES_MANAGE => ['name' => 'Manage custom roles', 'group' => 'team'],
            self::PRODUCTS_VIEW => ['name' => 'View products', 'group' => 'products'],
            self::PRODUCTS_MANAGE => ['name' => 'Create, edit and archive products', 'group' => 'products'],
            self::PRODUCTS_PRICE => ['name' => 'Change product prices and costs', 'group' => 'products'],
            self::CATEGORIES_MANAGE => ['name' => 'Manage categories', 'group' => 'products'],
            self::INVENTORY_VIEW => ['name' => 'View stock levels and history', 'group' => 'inventory'],
            self::INVENTORY_ADJUST => ['name' => 'Adjust stock', 'group' => 'inventory'],
            self::INVENTORY_TRANSFER => ['name' => 'Create and process stock transfers', 'group' => 'inventory'],
            self::INVENTORY_COUNT => ['name' => 'Perform stock counts', 'group' => 'inventory'],
            self::SUPPLIERS_VIEW => ['name' => 'View suppliers', 'group' => 'purchasing'],
            self::SUPPLIERS_MANAGE => ['name' => 'Manage suppliers', 'group' => 'purchasing'],
            self::PURCHASING_VIEW => ['name' => 'View purchase orders and receipts', 'group' => 'purchasing'],
            self::PURCHASING_MANAGE => ['name' => 'Create and manage purchase orders', 'group' => 'purchasing'],
            self::PURCHASING_RECEIVE => ['name' => 'Receive goods', 'group' => 'purchasing'],
            self::CUSTOMERS_VIEW => ['name' => 'View customers', 'group' => 'customers'],
            self::CUSTOMERS_MANAGE => ['name' => 'Manage customers', 'group' => 'customers'],
            self::REGISTERS_MANAGE => ['name' => 'Manage registers', 'group' => 'pos'],
            self::SHIFTS_OPERATE => ['name' => 'Open and close own cashier shift', 'group' => 'pos'],
            self::SHIFTS_VIEW_ALL => ['name' => 'View and close all cashier shifts', 'group' => 'pos'],
            self::SALES_CREATE => ['name' => 'Process sales (checkout)', 'group' => 'pos'],
            self::SALES_VIEW => ['name' => 'View own sales', 'group' => 'pos'],
            self::SALES_VIEW_ALL => ['name' => 'View all sales in authorized branches', 'group' => 'pos'],
            self::SALES_DISCOUNT => ['name' => 'Apply manual line discounts', 'group' => 'pos'],
            self::SALES_VOID => ['name' => 'Void sales', 'group' => 'pos'],
            self::REFUNDS_CREATE => ['name' => 'Request refunds', 'group' => 'pos'],
            self::REFUNDS_APPROVE => ['name' => 'Approve restricted refunds', 'group' => 'pos'],
            self::EXPENSES_VIEW => ['name' => 'View expenses', 'group' => 'finance'],
            self::EXPENSES_MANAGE => ['name' => 'Record and edit expenses', 'group' => 'finance'],
            self::REPORTS_VIEW => ['name' => 'View sales and inventory reports', 'group' => 'reports'],
            self::REPORTS_FINANCIAL => ['name' => 'View cost, expense and profit reports', 'group' => 'reports'],
            self::AUDIT_VIEW => ['name' => 'View audit logs', 'group' => 'reports'],
        ];
    }

    public const ROLE_OWNER = 'business_owner';

    public const ROLE_MANAGER = 'branch_manager';

    public const ROLE_CASHIER = 'cashier';

    public const ROLE_INVENTORY = 'inventory_staff';

    /** @return array<string, array{name: string, description: string, permissions: list<string>}> */
    public static function systemRoles(): array
    {
        $all = array_keys(self::catalogue());

        return [
            self::ROLE_OWNER => [
                'name' => 'Business Owner',
                'description' => 'Full access to the business.',
                'permissions' => $all,
            ],
            self::ROLE_MANAGER => [
                'name' => 'Branch Manager',
                'description' => 'Runs day-to-day operations of assigned branches.',
                'permissions' => array_values(array_diff($all, [
                    self::TENANT_MANAGE,
                    self::BRANCHES_MANAGE,
                    self::MEMBERS_MANAGE,
                    self::ROLES_MANAGE,
                ])),
            ],
            self::ROLE_CASHIER => [
                'name' => 'Cashier',
                'description' => 'Processes sales at a register.',
                'permissions' => [
                    self::PRODUCTS_VIEW,
                    self::INVENTORY_VIEW,
                    self::CUSTOMERS_VIEW,
                    self::CUSTOMERS_MANAGE,
                    self::SHIFTS_OPERATE,
                    self::SALES_CREATE,
                    self::SALES_VIEW,
                    self::REFUNDS_CREATE,
                ],
            ],
            self::ROLE_INVENTORY => [
                'name' => 'Inventory Staff',
                'description' => 'Maintains stock, transfers and receiving.',
                'permissions' => [
                    self::PRODUCTS_VIEW,
                    self::INVENTORY_VIEW,
                    self::INVENTORY_ADJUST,
                    self::INVENTORY_TRANSFER,
                    self::INVENTORY_COUNT,
                    self::SUPPLIERS_VIEW,
                    self::PURCHASING_VIEW,
                    self::PURCHASING_RECEIVE,
                ],
            ],
        ];
    }
}
