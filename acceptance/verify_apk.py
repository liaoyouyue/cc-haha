#!/usr/bin/env python3
"""Verify APK integrity and extract metadata for acceptance testing."""
import hashlib
import subprocess
import sys
from pathlib import Path

APK_PATH = Path(__file__).parent / 'apk' / 'CCHH-Mobile-v0.1.5.apk'
SHA256_PATH = Path(__file__).parent / 'apk' / 'SHA256SUMS.txt'

def verify_sha256():
    """Verify APK SHA256 matches the recorded value."""
    expected = None
    if SHA256_PATH.exists():
        content = SHA256_PATH.read_text().strip()
        expected = content.split()[0]

    hasher = hashlib.sha256()
    with APK_PATH.open('rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            hasher.update(chunk)
    actual = hasher.hexdigest()

    print(f"Expected SHA256: {expected}")
    print(f"Actual   SHA256: {actual}")
    if expected and actual != expected:
        print("❌ SHA256 MISMATCH")
        return False
    print("✅ SHA256 OK")
    return True

def extract_apk_info():
    """Extract package info using aapt if available."""
    try:
        result = subprocess.run(
            ['aapt', 'dump', 'badging', str(APK_PATH)],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            print("\n=== APK Metadata ===")
            for line in result.stdout.split('\n'):
                if any(k in line for k in ['package:', 'versionCode', 'versionName', 'application:']):
                    print(line)
    except FileNotFoundError:
        print("aapt not found, skipping metadata extraction")
    except subprocess.TimeoutExpired:
        print("aapt timeout")

def check_signature():
    """Check APK signature with apksigner if available."""
    try:
        result = subprocess.run(
            ['apksigner', 'verify', '--verbose', str(APK_PATH)],
            capture_output=True, text=True, timeout=30
        )
        print("\n=== Signature Verification ===")
        if result.returncode == 0:
            print("✅ Signature VERIFIED")
        else:
            print("❌ Signature INVALID")
        for line in result.stdout.split('\n')[:10]:
            if line.strip():
                print(line)
    except FileNotFoundError:
        print("apksigner not found, skipping signature check")

def main():
    print(f"Verifying: {APK_PATH}")
    print(f"Size: {APK_PATH.stat().st_size:,} bytes")

    ok = verify_sha256()
    extract_apk_info()
    check_signature()

    if ok:
        print("\n✅ APK verification PASSED")
        return 0
    else:
        print("\n❌ APK verification FAILED")
        return 1

if __name__ == '__main__':
    sys.exit(main())