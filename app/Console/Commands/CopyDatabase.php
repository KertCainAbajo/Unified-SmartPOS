<?php

namespace App\Console\Commands;

use App\Services\Catalog\ProductImageService;
use App\Services\Recruitment\RecruitmentService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

/**
 * `php artisan smartpos:copy-data` — copy every row from another database connection (e.g. your local
 * MySQL) into this one (e.g. Supabase PostgreSQL, already migrated and empty), then optionally upload the photos
 * and applicant documents to this environment's file disks. Run with the target's settings, e.g. `--env=supabase`.
 */
class CopyDatabase extends Command
{
    protected $signature = 'smartpos:copy-data
        {--from=source : Connection to copy from (the SOURCE_DB_* settings)}
        {--files-from= : Also copy uploads: the source environment\'s disk for photos, e.g. public}
        {--documents-from=local : Source disk for applicant documents (with --files-from)}
        {--force : Copy even though this database already has users}';

    protected $description = 'Copy all data (and optionally uploads) from another database into this one';

    /** Rebuilt by the target itself, or only meaningful on the old server. */
    private const SKIP = ['migrations', 'cache', 'cache_locks', 'sessions', 'jobs', 'job_batches', 'failed_jobs', 'login_challenges', 'trusted_devices', 'personal_access_tokens'];

    public function handle(): int
    {
        $from = DB::connection((string) $this->option('from'));
        $to = DB::connection();
        $this->info("From: {$from->getDriverName()} {$from->getDatabaseName()}  →  To: {$to->getDriverName()} {$to->getDatabaseName()}");

        if ($to->table('users')->exists() && ! $this->option('force')) {
            $this->error('The target already has users. Run on an empty, freshly migrated database (or pass --force).');

            return self::FAILURE;
        }
        if (! $this->option('no-interaction') && ! $this->confirm('Copy all rows into the target database now?', true)) {
            return self::FAILURE;
        }

        $tables = $this->ordered(array_values(array_diff(
            array_map(fn ($t) => $t['name'], Schema::connection($from->getName())->getTables()),
            self::SKIP,
        )));
        $targetTables = array_map(fn ($t) => $t['name'], Schema::getTables());
        // Rows reference each other both ways (a business has an owner; staff accounts belong to a business), so the
        // relationship checks are paused while copying, the usual way to load data into PostgreSQL / Supabase.
        if ($to->getDriverName() === 'pgsql') {
            $to->statement('SET session_replication_role = replica');
        } else {
            Schema::disableForeignKeyConstraints();
        }

        foreach ($tables as $table) {
            if (! in_array($table, $targetTables, true)) {
                $this->warn("  skip {$table} (not in target)");

                continue;
            }
            $columns = collect(Schema::getColumns($table))->keyBy('name');
            $booleans = $columns->filter(fn ($c) => in_array(strtolower($c['type_name']), ['bool', 'boolean'], true))->keys()->all();
            $count = 0;
            $from->table($table)->orderBy($this->orderColumn($from, $table))->chunk(500, function ($rows) use ($to, $table, $columns, $booleans, &$count) {
                $insert = $rows->map(function ($row) use ($columns, $booleans) {
                    $row = array_intersect_key((array) $row, $columns->all());
                    foreach ($booleans as $column) {
                        if (array_key_exists($column, $row) && $row[$column] !== null) {
                            $row[$column] = (bool) $row[$column];
                        }
                    }

                    return $row;
                })->all();
                $to->table($table)->insert($insert);
                $count += count($insert);
            });
            $this->resetSequence($table, $columns->has('id'));
            $this->line(sprintf('  %-34s %6d rows', $table, $count));
        }

        if ($to->getDriverName() === 'pgsql') {
            $to->statement('SET session_replication_role = DEFAULT');
        } else {
            Schema::enableForeignKeyConstraints();
        }

        if ($disk = $this->option('files-from')) {
            $this->copyFiles((string) $disk, ProductImageService::disk(), 'products');
            $this->copyFiles((string) $this->option('documents-from'), Storage::disk(RecruitmentService::documentsDisk()), 'recruitment');
        }

        $this->info('Done. Sign in on the new site with your existing accounts.');

        return self::SUCCESS;
    }

    /** Parents before children, following the foreign keys. */
    private function ordered(array $tables): array
    {
        $deps = [];
        foreach ($tables as $table) {
            $deps[$table] = array_values(array_intersect(
                array_map(fn ($fk) => $fk['foreign_table'], Schema::getForeignKeys($table)),
                $tables,
            ));
        }
        $done = [];
        $visit = function (string $table, array $path = []) use (&$visit, &$done, $deps) {
            if (isset($done[$table]) || in_array($table, $path, true)) {
                return;
            }
            foreach ($deps[$table] as $parent) {
                if ($parent !== $table) {
                    $visit($parent, [...$path, $table]);
                }
            }
            $done[$table] = true;
        };
        foreach ($tables as $table) {
            $visit($table);
        }

        return array_keys($done);
    }

    private function orderColumn($connection, string $table): string
    {
        $columns = array_map(fn ($c) => $c['name'], Schema::connection($connection->getName())->getColumns($table));

        return in_array('id', $columns, true) ? 'id' : $columns[0];
    }

    private function resetSequence(string $table, bool $hasId): void
    {
        if (! $hasId || DB::getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("SELECT setval(pg_get_serial_sequence(?, 'id'), COALESCE((SELECT MAX(id) FROM \"{$table}\"), 0) + 1, false)", [$table]);
    }

    private function copyFiles(string $sourceDisk, $target, string $folder): void
    {
        $source = Storage::disk($sourceDisk);
        $files = $source->allFiles($folder);
        foreach ($files as $path) {
            $target->put($path, $source->get($path));
        }
        $this->line(sprintf('  %-34s %6d files', "uploads: {$folder}", count($files)));
    }
}
