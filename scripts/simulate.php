<?php

/**
 * Loop engine runner: plays the business simulation (tests/Feature/SystemSimulationTest.php) again and again with
 * different random seeds, and stops at the first run that breaks an invariant, printing the seed to reproduce it.
 *
 *   composer simulate                              # 10 runs × 300 rounds on SQLite
 *   composer simulate -- --runs=50 --rounds=500    # longer soak
 *   composer simulate -- --mysql                   # against the MySQL test database (phpunit.mysql.xml)
 *   composer simulate -- --seed=12345              # replay one exact run
 */
$options = getopt('', ['runs::', 'rounds::', 'seed::', 'mysql']);
$runs = max(1, (int) ($options['runs'] ?? 10));
$rounds = max(1, (int) ($options['rounds'] ?? 300));
$config = isset($options['mysql']) ? 'phpunit.mysql.xml' : 'phpunit.xml';
$fixedSeed = isset($options['seed']) ? (int) $options['seed'] : null;
if ($fixedSeed !== null) {
    $runs = 1;
}

$root = dirname(__DIR__);
$phpunit = escapeshellarg($root.DIRECTORY_SEPARATOR.'vendor'.DIRECTORY_SEPARATOR.'bin'.DIRECTORY_SEPARATOR.'phpunit');
$started = microtime(true);
printf("Loop engine: %d run(s) × %d rounds using %s\n\n", $runs, $rounds, $config);

for ($run = 1; $run <= $runs; $run++) {
    $seed = $fixedSeed ?? random_int(1, 999_999);
    putenv("SIM_SEED={$seed}");
    putenv("SIM_ROUNDS={$rounds}");
    $t = microtime(true);
    $output = [];
    exec(PHP_BINARY.' '.$phpunit.' -c '.escapeshellarg($root.DIRECTORY_SEPARATOR.$config).' --filter SystemSimulationTest 2>&1', $output, $code);
    $text = implode("\n", $output);

    preg_match('/results: (\{.*\})/', $text, $m);
    printf("[%2d/%d] seed=%-6d %s  %5.1fs  %s\n", $run, $runs, $seed, $code === 0 ? 'PASS' : 'FAIL', microtime(true) - $t, $m[1] ?? '');

    if ($code !== 0) {
        echo "\n".$text."\n\nReproduce: composer simulate -- --seed={$seed} --rounds={$rounds}".(isset($options['mysql']) ? ' --mysql' : '')."\n";
        exit(1);
    }
}

printf("\nAll %d runs passed in %.1fs.\n", $runs, microtime(true) - $started);
