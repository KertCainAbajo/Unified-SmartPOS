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

    public const ROLES_MANAGE = 'roles.manage';

    // Staff accounts (company-managed employee accounts). See docs/STAFF_ACCOUNTS.md.
    public const STAFF_VIEW = 'staff.view';

    public const STAFF_CREATE = 'staff.create';

    public const STAFF_UPDATE = 'staff.update';

    public const STAFF_STATUS = 'staff.status';

    public const STAFF_OFFBOARD = 'staff.offboard';

    public const STAFF_ASSIGN_ROLES = 'staff.assign_roles';

    public const STAFF_ASSIGN_BRANCHES = 'staff.assign_branches';

    public const STAFF_CREDENTIALS = 'staff.credentials';

    public const STAFF_AUDIT = 'staff.audit';

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

    /** See applications of accessible branches (managers: from their interview stage on, or when assigned). */
    public const RECRUITMENT_VIEW = 'recruitment.view';

    public const RECRUITMENT_VACANCIES = 'recruitment.vacancies';

    /** HR: screening, HR interviews, scheduling, clarifications, offers and onboarding. */
    public const RECRUITMENT_HR = 'recruitment.hr';

    /** Conduct the second (branch manager) interview for own branches. */
    public const RECRUITMENT_MANAGER_INTERVIEW = 'recruitment.manager_interview';

    /** Conduct the final interview and approve hiring. The owner always may; others only as an owner-granted delegate. */
    public const RECRUITMENT_FINAL_APPROVAL = 'recruitment.final_approval';

    /**
     * Administrative permissions. Roles containing any of them can only be granted by the business owner,
     * and members holding them can only be modified by the owner (prevents lateral escalation between admins).
     */
    public const PRIVILEGED = [
        self::TENANT_MANAGE,
        self::BRANCHES_MANAGE,
        self::ROLES_MANAGE,
        self::STAFF_CREATE,
        self::STAFF_STATUS,
        self::STAFF_OFFBOARD,
        self::STAFF_ASSIGN_ROLES,
        self::STAFF_ASSIGN_BRANCHES,
        self::STAFF_CREDENTIALS,
        self::RECRUITMENT_FINAL_APPROVAL,
    ];

    /** @return array<string, array{name: string, group: string}> */
    public static function catalogue(): array
    {
        return [
            self::TENANT_MANAGE => ['name' => 'Manage business settings', 'group' => 'business'],
            self::BRANCHES_MANAGE => ['name' => 'Manage branches', 'group' => 'business'],
            self::ROLES_MANAGE => ['name' => 'Manage custom roles', 'group' => 'team'],
            self::STAFF_VIEW => ['name' => 'View staff accounts', 'group' => 'team'],
            self::STAFF_CREATE => ['name' => 'Create staff accounts', 'group' => 'team'],
            self::STAFF_UPDATE => ['name' => 'Edit staff profile details', 'group' => 'team'],
            self::STAFF_STATUS => ['name' => 'Suspend and reactivate staff', 'group' => 'team'],
            self::STAFF_OFFBOARD => ['name' => 'Offboard staff (revoke all access)', 'group' => 'team'],
            self::STAFF_ASSIGN_ROLES => ['name' => 'Assign roles to staff', 'group' => 'team'],
            self::STAFF_ASSIGN_BRANCHES => ['name' => 'Assign staff to branches', 'group' => 'team'],
            self::STAFF_CREDENTIALS => ['name' => 'Issue activation and recovery codes', 'group' => 'team'],
            self::STAFF_AUDIT => ['name' => 'View staff account audit trail', 'group' => 'team'],
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
            self::AUDIT_VIEW => ['name' => 'View the full audit log', 'group' => 'reports'],
            self::RECRUITMENT_VIEW => ['name' => 'View job applications', 'group' => 'recruitment'],
            self::RECRUITMENT_VACANCIES => ['name' => 'Manage vacancies', 'group' => 'recruitment'],
            self::RECRUITMENT_HR => ['name' => 'Screen applicants, HR interviews, offers and onboarding', 'group' => 'recruitment'],
            self::RECRUITMENT_MANAGER_INTERVIEW => ['name' => 'Conduct branch manager interviews', 'group' => 'recruitment'],
            self::RECRUITMENT_FINAL_APPROVAL => ['name' => 'Final interview and hiring approval', 'group' => 'recruitment'],
        ];
    }

    public const ROLE_OWNER = 'business_owner';

    public const ROLE_ACCESS_MANAGER = 'user_access_manager';

    public const ROLE_MANAGER = 'branch_manager';

    public const ROLE_CASHIER = 'cashier';

    public const ROLE_INVENTORY = 'inventory_staff';

    public const ROLE_ACCOUNTANT = 'accountant';

    public const ROLE_PURCHASING = 'purchasing_staff';

    public const ROLE_AUDITOR = 'auditor';

    public const ROLE_CUSTOMER_SERVICE = 'customer_service';

    /**
     * Owners, managers and HR (User & Access Manager) sign in with their email address, never with a username or
     * employee ID. Any role carrying an administrative permission is treated the same way.
     */
    public const EMAIL_SIGN_IN_ROLES = [self::ROLE_OWNER, self::ROLE_ACCESS_MANAGER, self::ROLE_MANAGER];

    /** @return array<string, array{name: string, description: string, permissions: list<string>}> */
    public static function systemRoles(): array
    {
        $all = array_keys(self::catalogue());
        $staffAdmin = [
            self::STAFF_VIEW, self::STAFF_CREATE, self::STAFF_UPDATE, self::STAFF_STATUS, self::STAFF_OFFBOARD,
            self::STAFF_ASSIGN_ROLES, self::STAFF_ASSIGN_BRANCHES, self::STAFF_CREDENTIALS, self::STAFF_AUDIT,
        ];

        return [
            self::ROLE_OWNER => [
                'name' => 'Business Owner',
                'description' => 'Full access to the business.',
                'permissions' => $all,
            ],
            self::ROLE_ACCESS_MANAGER => [
                'name' => 'User & Access Manager',
                'description' => 'HR: manages recruitment, staff accounts and access; no sales, stock or financial data.',
                'permissions' => [...$staffAdmin, self::RECRUITMENT_VIEW, self::RECRUITMENT_VACANCIES, self::RECRUITMENT_HR],
            ],
            self::ROLE_MANAGER => [
                'name' => 'Branch Manager',
                'description' => 'Runs day-to-day operations of assigned branches: staff, stock, sales and new branches. No business settings, profit reports or full audit log.',
                // Staff administration is limited by the usual rules: own branches only, non-administrative roles only,
                // and other managers or administrators can only be changed by the owner.
                // Owner-only: business settings, roles, profit/cost reports and the full audit log.
                'permissions' => array_values(array_diff($all, [
                    self::TENANT_MANAGE,
                    self::ROLES_MANAGE,
                    self::REPORTS_FINANCIAL,
                    self::AUDIT_VIEW,
                    // Recruitment: second interview only; screening, offers and final approval belong to HR and the owner.
                    self::RECRUITMENT_VACANCIES,
                    self::RECRUITMENT_HR,
                    self::RECRUITMENT_FINAL_APPROVAL,
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
            self::ROLE_ACCOUNTANT => [
                'name' => 'Accountant / Finance',
                'description' => 'Financial reports, expenses and review of sales and purchasing.',
                'permissions' => [
                    self::REPORTS_VIEW,
                    self::REPORTS_FINANCIAL,
                    self::EXPENSES_VIEW,
                    self::EXPENSES_MANAGE,
                    self::SALES_VIEW_ALL,
                    self::PRODUCTS_VIEW,
                    self::INVENTORY_VIEW,
                    self::SUPPLIERS_VIEW,
                    self::PURCHASING_VIEW,
                    self::CUSTOMERS_VIEW,
                ],
            ],
            self::ROLE_PURCHASING => [
                'name' => 'Purchasing / Procurement',
                'description' => 'Suppliers, purchase orders and receiving.',
                'permissions' => [
                    self::PRODUCTS_VIEW,
                    self::INVENTORY_VIEW,
                    self::SUPPLIERS_VIEW,
                    self::SUPPLIERS_MANAGE,
                    self::PURCHASING_VIEW,
                    self::PURCHASING_MANAGE,
                    self::PURCHASING_RECEIVE,
                ],
            ],
            self::ROLE_AUDITOR => [
                'name' => 'Auditor / Read-only',
                'description' => 'Reviews records without changing anything.',
                'permissions' => [
                    self::PRODUCTS_VIEW,
                    self::INVENTORY_VIEW,
                    self::SUPPLIERS_VIEW,
                    self::PURCHASING_VIEW,
                    self::CUSTOMERS_VIEW,
                    self::SALES_VIEW_ALL,
                    self::EXPENSES_VIEW,
                    self::REPORTS_VIEW,
                    self::REPORTS_FINANCIAL,
                    self::AUDIT_VIEW,
                    self::STAFF_VIEW,
                ],
            ],
            self::ROLE_CUSTOMER_SERVICE => [
                'name' => 'Customer Service',
                'description' => 'Customer records, sale look-ups and refund requests.',
                'permissions' => [
                    self::CUSTOMERS_VIEW,
                    self::CUSTOMERS_MANAGE,
                    self::PRODUCTS_VIEW,
                    self::INVENTORY_VIEW,
                    self::SALES_VIEW_ALL,
                    self::REFUNDS_CREATE,
                ],
            ],
        ];
    }

    /**
     * Read-only permissions: holding only these never allows changing operational data.
     *
     * @return list<string>
     */
    public static function readOnly(): array
    {
        return [
            self::STAFF_VIEW, self::STAFF_AUDIT, self::PRODUCTS_VIEW, self::INVENTORY_VIEW, self::SUPPLIERS_VIEW,
            self::PURCHASING_VIEW, self::CUSTOMERS_VIEW, self::SALES_VIEW, self::SALES_VIEW_ALL,
            self::EXPENSES_VIEW, self::REPORTS_VIEW, self::REPORTS_FINANCIAL, self::AUDIT_VIEW,
        ];
    }
}
