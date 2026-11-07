"""Installer integration checks with all host mutations redirected or simulated."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'install.sh'

MOCKS = r'''
install() { printf 'install %s\n' "$*" >> "$LOG"; command install "$@"; }
sleep() { :; }
systemctl() {
    echo "systemctl $*" >> "$LOG"
    [[ "${FAIL_SERVICE:-}" != 1 || "$1" != is-active ]]
}
command() {
    if [[ "${NO_DOCKER:-}" == 1 && "$*" == '-v docker' ]]; then return 1; fi
    builtin command "$@"
}
docker() {
    echo "docker $*" >> "$LOG"
    case "$*" in
        info) [[ "${FAIL_DOCKER:-}" != 1 ]];;
        'compose version') [[ "${NO_COMPOSE:-}" != 1 ]];;
        'compose up --help') echo "${COMPOSE_HELP:---wait-timeout}";;
        *login*) cat >/dev/null;;
        *'config --quiet'*) [[ "${FAIL_CONFIG:-}" != 1 ]];;
        *' up '*) [[ "${FAIL_HEALTH:-}" != 1 ]];;
        *pull*) [[ "${FAIL_PULL:-}" != 1 ]];;
    esac
}
curl() {
    echo "curl $*" >> "$LOG"
    [[ "${FAIL_DOWNLOAD:-}" != 1 ]] || return 1
    local url='' output=''
    while [[ $# -gt 0 ]]; do
        case "$1" in
            http://*) url="$1"; shift;;
            -o) output="$2"; shift 2;;
            *) shift;;
        esac
    done
    case "$url" in
        */SHA256SUMS)
            local core cli
            core=$(printf core | sha256sum); cli=$(printf cli | sha256sum)
            case "${CHECKSUM:-}" in
                missing) printf '%s  kida-cli\n' "${cli%% *}" > "$output";;
                duplicate) printf '%s  kida-core\n%s  kida-core\n' "${core%% *}" "${core%% *}" > "$output";;
                wrong) printf '%064d  kida-core\n' 0 > "$output";;
                *) printf '%s  kida-core\n%s  kida-cli\n' "${core%% *}" "${cli%% *}" > "$output";;
            esac;;
        */kida-core) printf core > "$output";;
        */kida-cli) printf cli > "$output";;
    esac
}
main
'''


class InstallerTest(unittest.TestCase):
    def run_installer(self, answers='n\nn\n', existing=None, **env):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            console = root / 'console'
            if existing is not None:
                console.mkdir()
                (console / '.env').write_text(existing)
            source = SCRIPT.read_text().replace(
                '[[ $EUID -eq 0 ]]', '[[ 0 -eq 0 ]]'
            ).replace('/opt/kida-console', str(console)).replace(
                '/usr/local/bin', str(root / 'bin')
            ).replace('/etc/systemd/system', str(root / 'systemd'))
            (root / 'bin').mkdir()
            (root / 'systemd').mkdir()
            script = root / 'installer.sh'
            script.write_text(source)
            log = root / 'log'
            log.touch()
            result = subprocess.run(
                ['bash', '-c', 'source "$1"\n' + MOCKS, 'test', str(script)],
                input=answers, text=True, capture_output=True,
                env={**os.environ, 'KIDA_VERSION': 'v1.2.3', 'KIDA_TOKEN': '',
                     'LOG': str(log), **env},
            )
            return (result, log.read_text(),
                    (console / '.env').read_text() if (console / '.env').exists() else None)

    def test_selections_and_order(self):
        for cli in (False, True):
            for console in (False, True):
                with self.subTest(cli=cli, console=console):
                    answers = ('y' if cli else 'n') + '\n' + ('y' if console else 'n') + '\n'
                    if console:
                        answers += 'http://localhost:8000\nlong-password-123\nlong-password-123\n'
                    result, log, config = self.run_installer(answers)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual('Downloading kida-cli...' in result.stdout, cli)
                    stages = [line for line in result.stdout.splitlines() if line.startswith('[')]
                    self.assertEqual(len(stages), 1 + cli + console)
                    self.assertIn('kida-core', stages[0])
                    if cli:
                        self.assertIn('kida-cli', stages[1])
                    if console:
                        self.assertIn('kida-console', stages[-1])
                        self.assertIn('KIDA_COOKIE_SECURE=false', config)
                        self.assertLess(log.index('pull '), log.index('install '))

    def test_preflight_failures_do_not_install(self):
        for failure in ({'NO_DOCKER': '1'}, {'FAIL_DOCKER': '1'},
                        {'NO_COMPOSE': '1'}, {'COMPOSE_HELP': 'old'},
                        {'FAIL_PULL': '1'}, {'FAIL_CONFIG': '1'}):
            with self.subTest(failure=failure):
                result, log, _ = self.run_installer('n\ny\n', existing='existing\n', **failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('install ', log)
                self.assertNotIn('installed successfully', result.stdout)

    def test_checksum_and_download_failures(self):
        for failure in ({'CHECKSUM': 'missing'}, {'CHECKSUM': 'duplicate'},
                        {'CHECKSUM': 'wrong'}, {'FAIL_DOWNLOAD': '1'}):
            with self.subTest(failure=failure):
                result, log, _ = self.run_installer(**failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('install ', log)

    def test_invalid_answer_and_eof(self):
        result, _, _ = self.run_installer('maybe\nn\nn\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Please answer', result.stdout)
        result, log, _ = self.run_installer('')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('install ', log)

    def test_service_and_health_failures(self):
        for failure in ({'FAIL_SERVICE': '1'}, {'FAIL_HEALTH': '1'}):
            result, _, _ = self.run_installer('n\ny\n', existing='existing\n', **failure)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('installed successfully', result.stdout)
            self.assertIn('Completed:', result.stderr)

    def test_preserve_existing_config(self):
        original = 'KIDA_ADMIN_PASSWORD=unchanged\n'
        result, log, config = self.run_installer('n\ny\n', existing=original)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(config, original)
        self.assertNotIn('down', log)

    def test_origin_validation_and_special_password(self):
        passwords = [r'''a'"$FOO\bar#123''', "abcdefghijkl" + chr(92),
                     "abcdefghijkl" + chr(92) + "'", r"abcdefghijkl\n\r\t",
                     "abcdefghijkl$${VALUE}#"]
        for password in passwords:
            with self.subTest(password=password):
                answers = '\n'.join(['n', 'y', 'https://host/path', 'https://host:99999',
                                     'https://host/', password, password, ''])
                result, _, config = self.run_installer(answers)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('KIDA_COOKIE_SECURE=true', config)
                self.assertIn('KIDA_ALLOWED_ORIGINS=https://host\n', config)
                self.assertNotIn(password, result.stdout + result.stderr)
                # Validate real Compose dotenv parsing without contacting Docker.
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    (root / '.env').write_text(config)
                    (root / 'compose.yaml').write_text('services:\n  console:\n    image: example\n    env_file: .env\n')
                    output = subprocess.check_output(
                        ['docker', 'compose', '-f', str(root / 'compose.yaml'), 'config', '--environment'],
                        text=True,
                    )
                    self.assertIn('KIDA_ADMIN_PASSWORD=' + password + '\n', output)


if __name__ == '__main__':
    unittest.main()
