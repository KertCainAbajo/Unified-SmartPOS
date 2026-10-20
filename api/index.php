<?php

/**
 * Vercel entry point for the Laravel API (runtime vercel-php). The deployed project folder is read-only, so
 * Laravel's caches, compiled views and temporary files go to /tmp, and logs go to Vercel's log (stderr).
 * Uploads must use Supabase Storage (SMARTPOS_FILES_DISK=s3); files written to /tmp disappear.
 */
$tmp = '/tmp/smartpos';
foreach (['framework/cache/data', 'framework/views', 'framework/sessions', 'logs', 'app/public', 'app/private'] as $dir) {
    if (! is_dir("{$tmp}/{$dir}")) {
        @mkdir("{$tmp}/{$dir}", 0777, true);
    }
}

$defaults = [
    'LARAVEL_STORAGE_PATH' => $tmp,
    'APP_CONFIG_CACHE' => "{$tmp}/config.php",
    'APP_EVENTS_CACHE' => "{$tmp}/events.php",
    'APP_PACKAGES_CACHE' => "{$tmp}/packages.php",
    'APP_ROUTES_CACHE' => "{$tmp}/routes.php",
    'APP_SERVICES_CACHE' => "{$tmp}/services.php",
    'VIEW_COMPILED_PATH' => "{$tmp}/framework/views",
    'LOG_CHANNEL' => 'stderr',
];
foreach ($defaults as $key => $value) {
    if (getenv($key) === false) {
        putenv("{$key}={$value}");
        $_ENV[$key] = $_SERVER[$key] = $value;
    }
}

// This file lives in /api, so PHP reports the script as /api/index.php and Laravel would treat /api as the site's
// base folder, turning /api/v1/me into /v1/me (404). Present it as the site root's index.php, as on a normal server.
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = realpath(__DIR__.'/../public/index.php') ?: __DIR__.'/../public/index.php';

require __DIR__.'/../public/index.php';
