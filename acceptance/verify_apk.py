#!/usr/bin/env python3
"""Verify one CCHH Mobile APK against its recorded SHA-256 and available SDK tools."""

import argparse
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path


def digest(apk):
    value = hashlib.sha256()
    with apk.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def expected_digest(apk, supplied):
    if supplied:
        return supplied.lower()
    sums = apk.parent / 'SHA256SUMS.txt'
    if not sums.exists():
        raise RuntimeError('缺少 SHA256SUMS.txt；请传 --sha256。')
    return sums.read_text(encoding='utf-8').split()[0].lower()


def optional_tool(name, *args):
    executable = shutil.which(name) or shutil.which(f'{name}.exe') or shutil.which(f'{name}.bat')
    if not executable:
        print(f'{name}: NOT CHECKED（工具不在 PATH）')
        return True
    result = subprocess.run([executable, *args], capture_output=True, text=True, timeout=30)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode:
        print(result.stderr.strip(), file=sys.stderr)
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description='验证 CCHH Mobile APK')
    parser.add_argument('apk', type=Path)
    parser.add_argument('--sha256', help='完整预期 SHA-256；默认读取 APK 同目录 SHA256SUMS.txt')
    args = parser.parse_args()

    apk = args.apk.resolve()
    if not apk.is_file():
        raise RuntimeError(f'APK 不存在：{apk}')
    expected = expected_digest(apk, args.sha256)
    actual = digest(apk)
    print(f'文件: {apk}')
    print(f'大小: {apk.stat().st_size} bytes')
    print(f'预期 SHA256: {expected}')
    print(f'实际 SHA256: {actual}')
    if actual != expected:
        raise RuntimeError('SHA-256 不一致。')

    metadata_ok = optional_tool('aapt', 'dump', 'badging', str(apk))
    signature_ok = optional_tool('apksigner', 'verify', '--verbose', '--print-certs', str(apk))
    if not metadata_ok or not signature_ok:
        raise RuntimeError('APK 元数据或签名检查失败。')
    print('PASS：SHA-256 一致；可用的 Android SDK 检查均通过。')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f'失败: {error}', file=sys.stderr)
        sys.exit(1)
