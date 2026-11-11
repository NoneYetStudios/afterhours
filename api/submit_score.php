<?php
/* POST api/submit_score.php  {"name": "...", "score": 1234, "time": 87}
 *
 * Duplicate handling: one row per player name (case-insensitive). A new submission only
 * replaces the stored row if the score is higher. Re-sending the same score is a no-op.
 */
require __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    ah_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

$raw = file_get_contents('php://input', false, null, 0, 4096);
$in = [];
if ($raw !== false && $raw !== '') {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        $in = $decoded;
    }
}
if (!$in && !empty($_POST)) {
    $in = $_POST;
}

/* ---- Validation ---- */
$name = isset($in['name']) && is_string($in['name']) ? trim(preg_replace('/\s+/', ' ', $in['name'])) : '';
if ($name === '' || strlen($name) > 12 || !preg_match('/^[A-Za-z0-9 _.\-!?]+$/', $name)) {
    ah_json(['ok' => false, 'error' => 'Name must be 1-12 characters: letters, numbers, spaces and _ . - ! ?'], 422);
}

function ah_int($v): ?int
{
    if (is_int($v)) {
        return $v;
    }
    if (is_string($v) && preg_match('/^\d{1,9}$/', $v)) {
        return (int) $v;
    }
    if (is_float($v) && $v >= 0 && $v < 1e9 && floor($v) == $v) {
        return (int) $v;
    }
    return null;
}

$score = ah_int($in['score'] ?? null);
$time = ah_int($in['time'] ?? ($in['survival_time'] ?? null));
if ($score === null || $time === null) {
    ah_json(['ok' => false, 'error' => 'Score and time must be whole numbers.'], 422);
}
if ($score < 0 || $score > 5000000 || $time < 1 || $time > 86400) {
    ah_json(['ok' => false, 'error' => 'Score or time out of range.'], 422);
}
// Plausibility: survival gives ~10 pts/s; kills and pickups add bursts but not unlimited.
if ($score > $time * 800 + 1000) {
    ah_json(['ok' => false, 'error' => 'Score rejected by Human Resources.'], 422);
}

$nameKey = strtolower($name);
$now = time();

try {
    $pdo = ah_db();

    /* ---- Rate limit per IP ---- */
    $ipHash = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '|afterhours');
    $pdo->exec('DELETE FROM rate_limit WHERE last_submit < ' . ($now - 3600));
    $st = $pdo->prepare('SELECT last_submit FROM rate_limit WHERE ip_hash = :h');
    $st->execute([':h' => $ipHash]);
    $last = $st->fetchColumn();
    if ($last !== false && ($now - (int) $last) < AH_MIN_SUBMIT_GAP) {
        ah_json(['ok' => false, 'error' => 'Slow down! Please wait a few seconds between submissions.'], 429);
    }

    $pdo->beginTransaction();
    $pdo->prepare('INSERT OR REPLACE INTO rate_limit (ip_hash, last_submit) VALUES (:h, :t)')
        ->execute([':h' => $ipHash, ':t' => $now]);

    $st = $pdo->prepare('SELECT id, score, survival_time, created_at FROM scores WHERE name_key = :k');
    $st->execute([':k' => $nameKey]);
    $existing = $st->fetch();

    if (!$existing) {
        $pdo->prepare(
            'INSERT INTO scores (name, name_key, score, survival_time, created_at)
             VALUES (:n, :k, :s, :t, :c)'
        )->execute([':n' => $name, ':k' => $nameKey, ':s' => $score, ':t' => $time, ':c' => $now]);
        $status = 'new';
        $rs = [$score, $time, $now];
    } elseif ($score > (int) $existing['score']) {
        $pdo->prepare(
            'UPDATE scores SET name = :n, score = :s, survival_time = :t, created_at = :c WHERE id = :id'
        )->execute([':n' => $name, ':s' => $score, ':t' => $time, ':c' => $now, ':id' => $existing['id']]);
        $status = 'improved';
        $rs = [$score, $time, $now];
    } else {
        $status = ($score === (int) $existing['score'] && $time === (int) $existing['survival_time'])
            ? 'duplicate' : 'not_improved';
        $rs = [(int) $existing['score'], (int) $existing['survival_time'], (int) $existing['created_at']];
    }

    // Keep the table small: retain only the top rows.
    $pdo->exec(
        'DELETE FROM scores WHERE id NOT IN (
            SELECT id FROM scores ORDER BY score DESC, survival_time DESC, created_at ASC LIMIT ' . AH_MAX_ROWS . '
        )'
    );
    $pdo->commit();

    $rank = ah_rank($pdo, $rs[0], $rs[1], $rs[2]);
    ah_json([
        'ok' => true,
        'status' => $status,
        'rank' => $rank,
        'best' => ['score' => $rs[0], 'survival_time' => $rs[1]],
    ]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    ah_json(['ok' => false, 'error' => 'Could not save your score. Please try again.'], 500);
}
