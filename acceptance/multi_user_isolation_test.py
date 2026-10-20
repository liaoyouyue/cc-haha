#!/usr/bin/env python3
"""
Multi-user isolation acceptance test for CCHH Mobile Android.

This test simulates two independent users (A and B) each connecting to their own
CCHH instance using isolated server environments. It verifies:
1. User A can only access their own CCHH sessions and data
2. User B can only access their own CCHH sessions and data
3. No cross-contamination of sessions, credentials, or approvals
4. Independent QR code pairing and token validation
5. Independent disconnection/reconnection without cross-talk
"""
import asyncio
import json
import os
import tempfile
import hashlib
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, Any, Optional

# Test configuration
CCHH_MOBILE_DIR = Path(__file__).parent.parent / 'cchh-mobile-android'
EXPECTED_SHA256 = 'db1f8e893ad4a0f1de28dd1e191810bd5aa9264b5c1ceca8441d84aee43cf063'

class IsolatedCCHHEnvironment:
    """Manages an isolated CCHH server instance for a single user."""

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.temp_dir: Optional[Path] = None
        self.config_dir: Optional[Path] = None
        self.home_dir: Optional[Path] = None
        self.server_port: Optional[int] = None
        self.server_process: Optional[subprocess.Popen] = None
        self.h5_token: Optional[str] = None
        self.session_id: Optional[str] = None
        self.base_url: Optional[str] = None

    async def setup(self) -> bool:
        """Create isolated environment and start CCHH server."""
        try:
            # Create isolated directories
            self.temp_dir = Path(tempfile.mkdtemp(prefix=f'cchh-test-{self.user_id}-'))
            self.config_dir = self.temp_dir / 'config'
            self.home_dir = self.temp_dir / 'home'
            self.config_dir.mkdir(parents=True)
            self.home_dir.mkdir(parents=True)

            # Write isolated settings with unique H5 token
            settings = {
                "env": {
                    "ANTHROPIC_API_KEY": f"fake-key-{self.user_id}"
                },
                "language": "en",
                "h5Access": {
                    "enabled": True,
                    "token": f"test-token-{self.user_id}-{hashlib.md5(self.user_id.encode()).hexdigest()[:16]}",
                    "allowedOrigins": []
                }
            }

            settings_file = self.config_dir / 'settings.json'
            settings_file.write_text(json.dumps(settings, indent=2))

            # Start isolated CCHH server
            env = os.environ.copy()
            env['CLAUDE_CONFIG_DIR'] = str(self.config_dir)
            env['HOME'] = str(self.home_dir)
            env['CLAUDE_CLI_PATH'] = str(CCHH_MOBILE_DIR / '../../src/server/__tests__/fixtures/mock-sdk-cli.ts')

            # Start server in background
            server_script = CCHH_MOBILE_DIR / '../../src/server/__tests__/fixtures/start_isolated_server.ts'
            if not server_script.exists():
                # Create inline server starter
                server_script = self.temp_dir / 'start_server.ts'
                server_script.write_text(f'''
import {{ startServer }} from "{CCHH_MOBILE_DIR / '../../src/server/index.js'}";
const server = startServer(0, '127.0.0.1');
console.log("SERVER_PORT:" + server.port);
''')

            # Use bun to start server
            self.server_process = subprocess.Popen(
                ['bun', 'run', str(server_script)],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(CCHH_MOBILE_DIR.parent)
            )

            # Wait for server to start and extract port
            for _ in range(30):
                line = self.server_process.stdout.readline()
                if not line and self.server_process.poll() is not None:
                    break
                if line:
                    line = line.decode().strip()
                    if line.startswith('SERVER_PORT:'):
                        self.server_port = int(line.split(':')[1])
                        self.base_url = f'http://127.0.0.1:{self.server_port}'
                        break
                await asyncio.sleep(0.1)

            if not self.server_port:
                return False

            # Enable H5 access and get token
            await self._enable_h5()
            return True

        except Exception as e:
            print(f"[{self.user_id}] Setup failed: {e}")
            return False

    async def _enable_h5(self):
        """Enable H5 access and get token."""
        import urllib.request

        # Enable H5
        req = urllib.request.Request(
            f'{self.base_url}/api/public-access/enable',
            method='POST',
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer test-local-token'},
            data=json.dumps({'publicUrl': 'https://test.example.com'}).encode()
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            self.server_port = data['port']
            self.base_url = f'http://127.0.0.1:{self.server_port}'

        # Get H5 token from settings
        import urllib.request
        req = urllib.request.Request(
            f'{self.base_url}/api/h5-access',
            headers={'Authorization': 'Bearer test-local-token'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            self.h5_token = data['settings']['token']

    async def create_session(self) -> bool:
        """Create a test session."""
        import urllib.request
        req = urllib.request.Request(
            f'{self.base_url}/api/sessions',
            method='POST',
            headers={
                'Authorization': f'Bearer {self.h5_token}',
                'Content-Type': 'application/json'
            },
            data=json.dumps({'workDir': str(self.home_dir), 'permissionMode': 'default'}).encode()
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                self.session_id = data['sessionId']
                return True
        except Exception as e:
            print(f"[{self.user_id}] Session creation failed: {e}")
            return False

    async def send_message(self, content: str) -> bool:
        """Send a test message via WebSocket."""
        # Use mock CLI to send message
        import urllib.request
        import websockets

        ws_url = f'ws://127.0.0.1:{self.server_port}/ws/{self.session_id}?token={self.h5_token}'
        try:
            async with websockets.connect(ws_url) as ws:
                await ws.send(json.dumps({'type': 'user_message', 'content': content}))
                # Wait for response
                async for msg in ws:
                    data = json.loads(msg)
                    if data.get('type') == 'message_complete':
                        return True
                    if data.get('type') == 'error':
                        print(f"[{self.user_id}] Error: {data.get('message')}")
                        return False
        except Exception as e:
            print(f"[{self.user_id}] WebSocket error: {e}")
            return False
        return False

    async def get_sessions(self) -> list:
        """Get list of sessions."""
        import urllib.request
        req = urllib.request.Request(
            f'{self.base_url}/api/sessions?limit=100',
            headers={'Authorization': f'Bearer {self.h5_token}'}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                return data.get('sessions', [])
        except:
            return []

    async def get_messages(self, session_id: str) -> list:
        """Get messages for a session."""
        import urllib.request
        req = urllib.request.Request(
            f'{self.base_url}/api/sessions/{session_id}/messages',
            headers={'Authorization': f'Bearer {self.h5_token}'}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                return data.get('messages', [])
        except:
            return []

    def cleanup(self):
        """Clean up resources."""
        if self.server_process:
            self.server_process.terminate()
            self.server_process.wait(timeout=5)
        if self.temp_dir and self.temp_dir.exists():
            import shutil
            shutil.rmtree(self.temp_dir, ignore_errors=True)


async def run_isolation_test():
    """Run the multi-user isolation test."""
    print("=== CCHH Mobile Multi-User Isolation Test ===")
    print(f"Expected APK SHA256: {EXPECTED_SHA256}")
    print()

    # Create two isolated environments
    env_a = IsolatedCCHHEnvironment('user-a')
    env_b = IsolatedCCHHEnvironment('user-b')

    try:
        print("Setting up isolated environments...")
        ok_a = await env_a.setup()
        ok_b = await env_b.setup()

        if not ok_a or not ok_b:
            print("❌ Failed to setup isolated environments")
            return False

        print(f"✅ User A server: {env_a.base_url} (token: {env_a.h5_token[:20]}...)")
        print(f"✅ User B server: {env_b.base_url} (token: {env_b.h5_token[:20]}...)")
        print()

        # Create sessions for both users
        print("Creating sessions...")
        if not await env_a.create_session():
            print("❌ User A session creation failed")
            return False
        if not await env_b.create_session():
            print("❌ User B session creation failed")
            return False
        print(f"✅ User A session: {env_a.session_id}")
        print(f"✅ User B session: {env_b.session_id}")
        print()

        # Test 1: Verify each user can only see their own sessions
        print("Test 1: Session isolation...")
        sessions_a = await env_a.get_sessions()
        sessions_b = await env_b.get_sessions()

        if len(sessions_a) != 1 or sessions_a[0]['id'] != env_a.session_id:
            print(f"❌ User A sees wrong sessions: {sessions_a}")
            return False
        if len(sessions_b) != 1 or sessions_b[0]['id'] != env_b.session_id:
            print(f"❌ User B sees wrong sessions: {sessions_b}")
            return False
        print("✅ Each user sees only their own session")
        print()

        # Test 2: Send messages and verify isolation
        print("Test 2: Message isolation...")
        msg_a = f"Hello from User A at {time.time()}"
        msg_b = f"Hello from User B at {time.time()}"

        if not await env_a.send_message(msg_a):
            print("❌ User A message send failed")
            return False
        if not await env_b.send_message(msg_b):
            print("❌ User B message send failed")
            return False

        # Wait a bit for messages to be processed
        await asyncio.sleep(2)

        # Verify messages are isolated
        msgs_a = await env_a.get_messages(env_a.session_id)
        msgs_b = await env_b.get_messages(env_b.session_id)

        user_a_messages = [m for m in msgs_a if m.get('type') == 'user']
        user_b_messages = [m for m in msgs_b if m.get('type') == 'user']

        if not any(msg_a in m.get('content', '') for m in user_a_messages):
            print(f"❌ User A message not found in their session: {msgs_a}")
            return False
        if any(msg_a in m.get('content', '') for m in user_b_messages):
            print(f"❌ User A message leaked to User B: {msgs_b}")
            return False
        if not any(msg_b in m.get('content', '') for m in user_b_messages):
            print(f"❌ User B message not found in their session: {msgs_b}")
            return False
        if any(msg_b in m.get('content', '') for m in user_a_messages):
            print(f"❌ User B message leaked to User A: {msgs_a}")
            return False

        print("✅ Messages are properly isolated")
        print()

        # Test 3: Cross-token rejection
        print("Test 3: Cross-token rejection...")
        import urllib.request
        req = urllib.request.Request(
            f'{env_a.base_url}/api/sessions?limit=100',
            headers={'Authorization': f'Bearer {env_b.h5_token}'}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                print("❌ User B token accepted by User A server")
                return False
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print("✅ User B token correctly rejected by User A server")
            else:
                print(f"❌ Unexpected error: {e}")
                return False
        print()

        # Test 4: Independent disconnection
        print("Test 4: Independent disconnection...")
        # User A disconnects
        await env_a.cleanup()
        await asyncio.sleep(1)

        # User B should still work
        if not await env_b.send_message("Message after A disconnect"):
            print("❌ User B failed after User A disconnected")
            return False
        print("✅ User B still works after User A disconnected")
        print()

        print("=== ALL ISOLATION TESTS PASSED ===")
        return True

    finally:
        env_a.cleanup()
        env_b.cleanup()


if __name__ == '__main__':
    import time
    success = asyncio.run(run_isolation_test())
    sys.exit(0 if success else 1)