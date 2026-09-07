#!/usr/bin/env python3
"""Read-only probes with an append-only, redacted local incident journal."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import time
import urllib.error
import urllib.request


def transition(previous, checks, now):
    failures = 0 if checks['ready'] else previous.get('readyFailures', 0) + 1
    active = sorted(name for name, ok in checks.items() if not ok and (name != 'ready' or failures >= 3))
    before = set(previous.get('active', []))
    after = set(active)
    events = [{'at': now, 'check': name, 'state': 'ALERT'} for name in sorted(after - before)]
    events += [{'at': now, 'check': name, 'state': 'RECOVERED'} for name in sorted(before - after)]
    return {'checkedAt': now, 'readyFailures': failures, 'active': active}, events


def probe(path):
    request = urllib.request.Request('http://127.0.0.1:3051' + path, headers={'Host': 'cloud.kai.com'})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return response.status == 200
    except (OSError, urllib.error.HTTPError):
        return False


def collect(state_root, epoch):
    checks = {'live': probe('/api/live'), 'ready': probe('/api/ready')}
    try:
        snapshot = json.loads((state_root / 'market/model-market.snapshot.json').read_text())
        if not isinstance(snapshot, dict):
            raise ValueError('invalid snapshot')
        stamp = snapshot.get('generatedAt') or snapshot.get('publishedAt')
        age = epoch - datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp()
        checks['market'] = 0 <= age <= 26 * 3600
    except (OSError, ValueError, TypeError, AttributeError):
        checks['market'] = False
    latest = 0
    for manifest_path in (state_root / 'backups').glob('kai-cloud-backup-*/manifest.json'):
        try:
            manifest = json.loads(manifest_path.read_text())
            if not isinstance(manifest, dict):
                continue
            if manifest.get('schemaVersion') != 'kai-cloud-backup/1':
                continue
            created = datetime.datetime.fromisoformat(manifest['createdAt'].replace('Z', '+00:00')).timestamp()
            latest = max(latest, created)
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue
    checks['backup'] = 0 <= epoch - latest <= 90 * 60
    try:
        database = sqlite3.connect(f'file:{state_root}/db/kai-cloud.sqlite?mode=ro', uri=True, timeout=2)
        try:
            count = database.execute("SELECT count(*) FROM card_hour_topup_orders WHERE status='RECONCILIATION_REQUIRED'").fetchone()[0]
            checks['reconciliation'] = count == 0
        finally:
            database.close()
    except sqlite3.Error:
        checks['reconciliation'] = False
    return checks


def main():
    os.umask(0o077)
    output = Path(os.environ.get('KAI_HEALTH_STATE_DIR', '/var/lib/kai-cloud-health'))
    state_root = Path(os.environ.get('KAI_STATE_ROOT', '/opt/kai-cloud-3051'))
    output.mkdir(parents=True, exist_ok=True)
    with (output / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = output / 'status.json'
        try:
            previous = json.loads(path.read_text())
        except (OSError, ValueError):
            previous = {}
        epoch = time.time()
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        checks = collect(state_root, epoch)
        status, events = transition(previous, checks, now)
        status['checks'] = checks
        with (output / 'events.ndjson').open('a') as journal:
            for event in events:
                journal.write(json.dumps(event) + '\n')
            journal.flush()
            os.fsync(journal.fileno())
        temporary = output / 'status.partial'
        temporary.write_text(json.dumps(status) + '\n')
        temporary.replace(path)
        print(json.dumps({'checkedAt': now, 'active': status['active'], 'newEvents': len(events)}))


if __name__ == '__main__':
    main()
