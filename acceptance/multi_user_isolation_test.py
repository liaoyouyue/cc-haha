#!/usr/bin/env python3
"""Run two isolated CCHH servers and verify session, token, and history isolation."""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
SERVER_SCRIPT = ROOT / 'cchh-mobile-android' / 'tests' / 'e2eServer.ts'
SEND_TURN = ROOT / 'cchh-mobile-android' / 'tests' / 'sendTurn.mjs'
BUN = shutil.which('bun.exe') or shutil.which('bun')
HTTP = build_opener(ProxyHandler({}))


def discover_lan_host():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(('192.0.2.1', 9))
            address = probe.getsockname()[0]
            if not address.startswith('127.'):
                return address
        except OSError:
            pass
    for entry in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
        address = entry[4][0]
        if not address.startswith(('127.', '169.254.')):
            return address
    raise RuntimeError('no non-loopback IPv4 address is available for H5 authentication checks')


def request_json(environment, path, token):
    request = Request(
        f'{environment.base_url}{path}',
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'},
    )
    try:
        with HTTP.open(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        body = error.read()
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = body.decode('utf-8', errors='replace')
        return error.code, payload


class IsolatedServer:
    def __init__(self, name, token, host):
        self.name = name
        self.token = token
        self.host = host
        self.root = Path(tempfile.mkdtemp(prefix=f'cchh-mobile-{name}-'))
        self.info_file = self.root / 'info.json'
        self.process = None
        self.info = None
        self.base_url = None

    def start(self):
        (self.root / 'home').mkdir()
        (self.root / 'config').mkdir()
        environment = os.environ.copy()
        environment.update({
            'HOME': str(self.root / 'home'),
            'CLAUDE_CONFIG_DIR': str(self.root / 'config'),
            'CCHH_E2E_INFO': str(self.info_file),
            'CCHH_E2E_TOKEN': self.token,
        })
        self.process = subprocess.Popen(
            [BUN, 'run', str(SERVER_SCRIPT)],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.info_file.exists():
                try:
                    self.info = json.loads(self.info_file.read_text(encoding='utf-8'))
                    self.base_url = f'http://{self.host}:{self.info["port"]}'
                    return
                except (json.JSONDecodeError, OSError):
                    pass
            if self.process.poll() is not None:
                output = self.process.communicate()[0]
                raise RuntimeError(f'{self.name} server exited during startup:\n{output}')
            time.sleep(0.1)
        raise RuntimeError(f'{self.name} server did not become ready')

    def send(self, text):
        result = subprocess.run(
            [BUN, 'run', str(SEND_TURN), str(self.info_file), text],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=50,
        )
        if result.returncode:
            raise RuntimeError(f'{self.name} send failed: {result.stderr or result.stdout}')

    def history_text(self):
        status, payload = request_json(
            self,
            f'/api/sessions/{self.info["sessionId"]}/messages',
            self.token,
        )
        if status != 200:
            raise RuntimeError(f'{self.name} history returned HTTP {status}')
        return json.dumps(payload, ensure_ascii=False)

    def wait_for_history(self, marker):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            history = self.history_text()
            if marker in history:
                return history
            time.sleep(0.1)
        raise RuntimeError(f'{self.name} history is missing {marker}')

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)

    def cleanup(self):
        self.stop()
        shutil.rmtree(self.root, ignore_errors=True)


def assert_own_session(environment):
    status, payload = request_json(environment, '/api/sessions?limit=100', environment.token)
    session_ids = {session.get('id') for session in payload.get('sessions', [])} if status == 200 else set()
    if status != 200 or session_ids != {environment.info['sessionId']}:
        raise RuntimeError(f'{environment.name} session isolation failed: HTTP {status}, IDs {session_ids}')


def assert_cross_token_rejected(target, foreign_token):
    status, _ = request_json(target, '/api/sessions?limit=100', foreign_token)
    if status != 401:
        raise RuntimeError(f'{target.name} accepted a foreign token with HTTP {status}')


def main():
    if not BUN:
        raise RuntimeError('bun/bun.exe not found in PATH')

    host = discover_lan_host()
    user_a = IsolatedServer('user-a', 'E2EUSERATOKEN0123456789ABCDEF', host)
    user_b = IsolatedServer('user-b', 'E2EUSERBTOKEN0123456789ABCDEF', host)
    try:
        user_a.start()
        user_b.start()
        assert_own_session(user_a)
        assert_own_session(user_b)
        assert_cross_token_rejected(user_a, user_b.token)
        assert_cross_token_rejected(user_b, user_a.token)

        user_a.send('A_ONLY_MARKER')
        user_b.send('B_ONLY_MARKER')
        history_a = user_a.wait_for_history('A_ONLY_MARKER')
        history_b = user_b.wait_for_history('B_ONLY_MARKER')
        if 'B_ONLY_MARKER' in history_a or 'A_ONLY_MARKER' in history_b:
            raise RuntimeError('message history crossed isolated servers')

        user_a.stop()
        assert_own_session(user_b)
        user_b.send('B_AFTER_A_STOPPED')
        user_b.wait_for_history('B_AFTER_A_STOPPED')
        print('PASS: two isolated servers kept sessions, tokens, histories, and lifecycles separate')
        return 0
    finally:
        user_a.cleanup()
        user_b.cleanup()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
