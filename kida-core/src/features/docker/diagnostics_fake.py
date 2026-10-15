#!/usr/bin/python3
import json
import os
from pathlib import Path
import sys
import time

root = Path(os.environ['KIDA_DIAGNOSTICS_DIR'])
a = sys.argv[1:]
with (root / 'calls').open('a') as f:
    f.write(json.dumps(a) + '\n')
case = json.loads((root / 'case').read_text())
if case.get('sleep') or case.get('slow_id') == a[-1]:
    (root / 'pid').write_text(str(os.getpid()))
    time.sleep(30)
if case.get('fail') or a[-1] in case.get('fail_ids', []):
    print('permission denied: SECRET', file=sys.stderr)
    sys.exit(1)
if a[0] == 'ps':
    assert a == ['ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=alpha'], a
    print('\n'.join(case.get('ids', [])))
elif a[:2] == ['container', 'inspect']:
    if case.get('invalid_json'):
        print('{')
    else:
        print(json.dumps(case.get('rows', {}).get(a[-1], [])))
elif a[:2] == ['container', 'logs']:
    assert a[2:4] == ['--tail', '25'], a
    os.write(1, bytes([255]) * case.get('stdout', 0))
    os.write(2, bytes([254]) * case.get('stderr', 0))
else:
    raise AssertionError(a)
