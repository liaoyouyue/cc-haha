#!/usr/bin/env python3
"""Run the device smoke test against a real Android device.

Usage: python run_device_smoke.py <apk_path> [--lan|--tailscale|--ngrok] [--base-url URL] [--token TOKEN] [--pair-secret SECRET]
"""
import argparse
import hashlib
import os
import subprocess
import sys
import time

PACKAGE = "com.cchh.mobile.client"

def sh(*args, check=True, **kwargs):
    return subprocess.run(args, check=check, capture_output=True, text=True, **kwargs).stdout

def verify_apk_sha256(apk_path, expected_sha256):
    hasher = hashlib.sha256()
    with open(apk_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            hasher.update(chunk)
    actual = hasher.hexdigest()
    if actual != expected_sha256:
        print(f"❌ SHA256 mismatch!")
        print(f"  Expected: {expected_sha256}")
        print(f"  Actual:   {actual}")
        return False
    print(f"✅ APK SHA256 verified")
    return True

def install_apk(apk_path):
    print("Installing APK...")
    try:
        sh("adb", "install", "-r", apk_path)
        print("✅ APK installed")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Install failed: {e.stderr}")
        return False

def launch_app():
    sh("adb", "shell", "am", "force-stop", PACKAGE)
    sh("adb", "shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    time.sleep(3)
    pid = sh("adb", "shell", "pidof", PACKAGE).strip()
    if pid:
        print(f"✅ App launched (PID: {pid})")
        return True
    print("❌ App not running")
    return False

def wait_for_text(text, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        raw = sh("adb", "exec-out", "uiautomator", "dump", "/data/local/tmp/check.xml")
        raw = sh("adb", "exec-out", "cat", "/data/local/tmp/check.xml")
        if text in raw:
            return True
        time.sleep(1)
    return False

def main():
    parser = argparse.ArgumentParser(description="CCHH Mobile device smoke test")
    parser.add_argument("apk", help="Path to APK file")
    parser.add_argument("--sha256", default="db1f8e893ad4a0f1de28dd1e191810bd5aa9264b5c1ceca8441d84aee43cf063")
    parser.add_argument("--lan", action="store_true", help="Test LAN connection")
    parser.add_argument("--tailscale", action="store_true", help="Test Tailscale connection")
    parser.add_argument("--ngrok", action="store_true", help="Test ngrok public pairing")
    parser.add_argument("--base-url", help="Server base URL (e.g., http://10.0.0.1:3456)")
    parser.add_argument("--token", help="H5 access token")
    parser.add_argument("--pair-secret", help="ngrok pairing secret")
    args = parser.parse_args()

    apk_path = args.apk
    if not os.path.exists(apk_path):
        print(f"❌ APK not found: {apk_path}")
        return 1

    # Verify APK
    if not verify_apk_sha256(apk_path, args.sha256):
        return 1

    # Install and launch
    if not install_apk(apk_path):
        return 1
    if not launch_app():
        return 1

    # Wait for connection screen
    if not wait_for_text("连接我自己的 CCHH", timeout=15):
        print("❌ Connection screen not found")
        return 1
    print("✅ Connection screen displayed")

    # TODO: Implement specific connection type tests
    print("\n⚠️  Manual steps required:")
    print("1. Choose connection type on device")
    if args.lan:
        print("2. Select '同一 Wi-Fi' and scan H5 QR from computer")
    elif args.tailscale:
        print("2. Select 'Tailscale' and scan H5 QR, then verify 100.x address")
    elif args.ngrok:
        print("2. Select '公网 ngrok' and scan pairing QR")
        print("3. Approve on computer, then tap '检查审批并连接'")
    else:
        print("2. Manually select connection type and proceed")

    print("3. After connection, verify:")
    print("   - Session list shows 'Untitled Session'")
    print("   - Can send message and receive 'Echo: ...' reply")
    print("   - Tool approval works (Write -> approve -> file created)")
    print("   - HOME -> resume works")
    print("   - Airplane mode toggle -> reconnect without duplicate")

    print("\n✅ Smoke test framework ready. Complete manual steps above.")
    return 0

if __name__ == '__main__':
    sys.exit(main())