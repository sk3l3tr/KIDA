#!/usr/bin/python3
"""Subprocess-only Docker fixture. No Docker daemon or environment mutation."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(os.environ['KIDA_LIFECYCLE_DIR'])
mode = (root / 'scenario').read_text()
project = os.environ.get('KIDA_TEST_PROJECT', 'alpha')
if mode == 'concurrent':
    root = root / project
    mode = 'normal'
a = sys.argv[1:]
with (root / 'calls').open('a') as log:
    log.write(json.dumps({'args': a, 'variable': os.environ.get('KIDA_INTERPOLATION'),
                          'profiles': os.environ.get('COMPOSE_PROFILES'),
                          'remove_orphans': os.environ.get('COMPOSE_REMOVE_ORPHANS')}) + '\n')

def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)

if mode.startswith('timeout-'):
    (root / 'parent-pid').write_text(str(os.getpid()))

if mode == 'daemon-error' and a[0] != 'compose':
    fail('Cannot connect to the Docker daemon')
if mode == 'list-error' and a[0] == 'network':
    fail('list failed')
if mode == 'timeout-check' or (mode == 'timeout-mutation' and 'create' in a):
    time.sleep(30)
if mode == 'timeout-total':
    time.sleep(0.1)
if mode == 'timeout-grandchild':
    child = subprocess.Popen(['/bin/sleep', '30'])
    (root / 'pid').write_text(str(child.pid))
    time.sleep(30)

# Managed state survives separate Docker invocations and consumer restarts.
state_path = root / 'state'
state = json.loads(state_path.read_text()) if state_path.exists() else {'container': [], 'network': [], 'volume': []}
def save():
    state_path.write_text(json.dumps(state))
def emit(rows):
    print(json.dumps(rows))
    sys.exit(0)
if a[0] == 'info':
    print('other-daemon' if mode == 'different-daemon' else 'daemon-one')
    sys.exit(0)
if mode == 'inventory-error' and a[0] == 'ps':
    fail('inventory failed')
if a[:2] == ['container', 'inspect'] or (a[0] in ['network', 'volume'] and a[1] == 'inspect'):
    if mode == 'capture-interrupted' and a[0] == 'container' and a[2] == '2' * 64:
        fail('injected inspect interruption')
    rows = [r for r in state[a[0]] if r.get('Id', r.get('Name')) in a[2:]]
    if not rows:
        fail('not found')
    emit(rows)
if len(a) == 3 and a[1] == 'rm':
    if mode == 'remove-error' and a[0] == 'network':
        fail('injected removal failure')
    rows = state[a[0]]
    row = next(r for r in rows if r.get('Id', r.get('Name')) == a[2])
    if a[0] == 'container' and row['State']['Running']:
        fail('running')
    rows.remove(row)
    save()
    sys.exit(0)
if state_path.exists():
    if a[:2] == ['ps', '-aq']:
        print('\n'.join(r['Id'] for r in state['container']))
        sys.exit(0)
    if a[0] in ['network', 'volume'] and a[1] == 'ls':
        kind = a[0]
        print('\n'.join(r['Name'] if '--format' in a or kind == 'volume' else r['Id'] for r in state[kind]))
        if kind == 'volume' and '--format' in a and mode != 'external-missing':
            print('shared')
        sys.exit(0)
    if a[0] == 'inspect':
        emit([r for r in state['container'] if r['Id'] in a[1:]])
    if a[0] == 'compose' and any(x in a for x in ['start', 'stop']):
        for row in state['container']:
            row['State']['Running'] = 'start' in a
        save()
        sys.exit(0)

if a[0] == 'compose':
    if mode == 'plugin-missing':
        fail("compose is not a docker command")
    assert a[:3] == ['compose', '--project-name', project], a
    assert a[3:7] == ['--file', str(root / 'compose with spaces.yaml'), '--project-directory', str(root)], a
    tail = a[9:] if a[7:8] == ['--file'] else a[7:]
    if tail == ['config', '--format', 'json']:
        if mode in ['config-error', 'missing-env-file']:
            fail('invalid Compose document')
        if mode in ['config-limit', 'config-overflow']:
            model = json.dumps({'services': {'web': {}}})
            size = 8 * 1024 * 1024 + (mode == 'config-overflow')
            if mode == 'config-overflow':
                (root / 'parent-pid').write_text(str(os.getpid()))
                child = subprocess.Popen(['/bin/sleep', '30'])
                (root / 'pid').write_text(str(child.pid))
            sys.stdout.write(model + ' ' * (size - len(model)))
            sys.stdout.flush()
            if mode == 'config-overflow':
                time.sleep(30)
            sys.exit(0)
        if mode == 'noisy':
            sys.stderr.write('diagnostic' * 20000)
        if mode == 'invalid-json':
            print('invalid json')
        elif mode == 'reserved-label':
            print(json.dumps({'services': {'web': {'labels': {'io.kida.owner': 'copied'}}}}))
        elif mode == 'invalid-model':
            print('{}')
        else:
            print(json.dumps({'services': {'web': {'container_name': 'explicit-web'}, 'db': {}, 'profiled': {'container_name': 'profiled-occupied', 'profiles': ['optional']}},
                              'networks': {'default': {'name': project + '_default'}},
                              'volumes': {'data': {'name': project + '_data'},
                                          'external': {'name': 'shared', 'external': True}}}))
    elif tail in [['create', '--no-recreate'], ['start'], ['stop']]:
        if mode in ['noisy-mutation', 'noisy-failure']:
            sys.stdout.write('output' * 2000000)
            sys.stderr.write('diagnostic' * 20000)
            if mode == 'noisy-failure':
                sys.exit(1)
        if mode == 'command-error':
            fail('operation failed after partial work')
        if 'create' in tail and a[7:8] == ['--file']:
            extra = json.loads(Path(a[8]).read_text())
            owner = next(iter(extra['services'].values()))['labels']['io.kida.owner']
            tags = {'io.kida.owner': owner, 'com.docker.compose.project': project}
            for i, service in enumerate(['web', 'db']):
                state['container'].append({'Id': str(i + 1) * 64, 'Name': service, 'Config': {'Labels': dict(tags, **{'com.docker.compose.service': service, 'com.docker.compose.project.config_files': a[4] + ',' + a[8], 'com.docker.compose.project.working_dir': str(root)})}, 'State': {'Running': False}, 'Mounts': [{'Type': 'volume', 'Name': project + '_data'}], 'NetworkSettings': {'Networks': {project + '_default': {'NetworkID': ''}}}})
            state['network'] = [{'Id': 'a' * 64, 'Name': project + '_default', 'Labels': dict(tags, **{'com.docker.compose.network': 'default'}), 'Containers': {}}]
            state['volume'] = [{'Name': project + '_data', 'CreatedAt': '2026-10-15T10:00:00Z', 'Driver': 'local', 'Scope': 'local', 'Options': None, 'Mountpoint': '/var/lib/docker/volumes/alpha_data/_data', 'Labels': dict(tags, **{'com.docker.compose.volume': 'data'})}]
            # Output-limit scenarios resolve a model with no declared resources.
            if mode == 'config-limit':
                state['network'] = []
                state['volume'] = []
                for row in state['container']:
                    row['Config']['Labels']['com.docker.compose.service'] = 'web'
            save()
            if mode == 'partial-create':
                fail('injected failure after creation')
        if mode == 'serialize':
            time.sleep(0.1)
            (root / 'created').write_text('yes')
    else:
        fail('unexpected compose args ' + repr(a))
elif a[:2] == ['ps', '-aq']:
    if mode in ['missing-env-file', 'external-missing', 'existing', 'foreign-origin', 'missing-label', 'wrong-project', 'wrong-file',
                'wrong-directory', 'multiple-files', 'mixed-provenance', 'inspect-invalid',
                'inspect-incomplete', 'inspect-wrong-id']:
        if mode not in ['missing-env-file', 'external-missing'] or '--no-trunc' in a:
            print('web-1\nweb-2\ndb-1')
    elif mode == 'project-container' or (mode == 'serialize' and (root / 'created').exists()):
        print('occupied')
elif a == ['ps', '-a', '--format', '{{.Names}}']:
    print('profiled-occupied')
    if mode == 'container-name':
        print('explicit-web')
elif a[0] in ['network', 'volume'] and a[1:3] == ['ls', '-q']:
    if mode == 'project-' + a[0]:
        print('occupied')
elif a[0] in ['network', 'volume'] and a[1:] == ['ls', '--format', '{{.Name}}']:
    if mode == a[0] + '-name':
        print(project + '_default' if a[0] == 'network' else project + '_data')
    if a[0] == 'volume' and mode != 'external-missing':
        print('shared')
elif a[0] == 'inspect':
    rows = []
    for i, ident in enumerate(a[1:]):
        labels = {'com.docker.compose.project': project,
                  'com.docker.compose.service': 'web' if ident.startswith('web') else 'db',
                  'com.docker.compose.project.config_files': str(root / 'compose with spaces.yaml'),
                  'com.docker.compose.project.working_dir': str(root)}
        if mode == 'missing-label':
            del labels['com.docker.compose.project.config_files']
        if mode in ['wrong-file', 'multiple-files'] or (mode == 'mixed-provenance' and i == 1):
            labels['com.docker.compose.project.config_files'] += ',other.yaml'
        if mode == 'wrong-project':
            labels['com.docker.compose.project'] = 'beta'
        if mode == 'wrong-directory':
            labels['com.docker.compose.project.working_dir'] = '/elsewhere'
        rows.append({'Id': ident if mode != 'inspect-wrong-id' else 'wrong', 'Config': {'Labels': labels}})
    if mode == 'inspect-incomplete':
        rows.pop()
    print('invalid' if mode == 'inspect-invalid' else json.dumps(rows))
else:
    fail('unexpected Docker arguments ' + repr(a))
