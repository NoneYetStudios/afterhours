<?php
/* After Hours - shared leaderboard helpers (PHP 7.4+, SQLite via PDO). */

const AH_DB_PATH = __DIR__ . '/../data/leaderboard.sqlite';
const AH_MAX_ROWS = 500;          // rows kept in the database (top scores)
const AH_BOARD_SIZE = 25;         // rows shown on the leaderboard
const AH_MIN_SUBMIT_GAP = 3;      // seconds between submissions from one IP

function ah_json(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function ah_db(): PDO
{
    if (!extension_loaded('pdo_sqlite')) {
        ah_json(['ok' => false, 'error' => 'Server is missing the pdo_sqlite PHP extension.'], 500);
    }
    $dir = dirname(AH_DB_PATH);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    try {
        $pdo = new PDO('sqlite:' . AH_DB_PATH);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA busy_timeout = 4000');
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                name_key TEXT NOT NULL UNIQUE,
                score INTEGER NOT NULL,
                survival_time INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )'
        );
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (score DESC, survival_time DESC, created_at ASC)');
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS rate_limit (
                ip_hash TEXT PRIMARY KEY,
                last_submit INTEGER NOT NULL
            )'
        );
        return $pdo;
    } catch (Throwable $e) {
        ah_json(['ok' => false, 'error' => 'Leaderboard database unavailable. Is the data/ folder writable?'], 500);
    }
    return new PDO('sqlite::memory:'); // unreachable
}

/** 1-based rank of a stored row (ordering: score desc, time desc, oldest first). */
function ah_rank(PDO $pdo, int $score, int $time, int $created): int
{
    $st = $pdo->prepare(
        'SELECT COUNT(*) FROM scores
         WHERE score > :s
            OR (score = :s AND survival_time > :t)
            OR (score = :s AND survival_time = :t AND created_at < :c)'
    );
    $st->execute([':s' => $score, ':t' => $time, ':c' => $created]);
    return (int) $st->fetchColumn() + 1;
}
