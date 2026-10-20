#!/usr/bin/env python3
"""Verify Android signing continuity and optionally perform an in-place upgrade."""

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

PACKAGE = 'com.cchh.mobile.client'


def run(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True)


def sdk_tool(name):
    direct = shutil.which(name) or shutil.which(f'{name}.exe') or shutil.which(f'{name}.bat')
    if direct:
        return direct
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not sdk:
        return None
    candidates = []
    for suffix in (name, f'{name}.exe', f'{name}.bat'):
        candidates.extend(Path(sdk).glob(f'build-tools/*/{suffix}'))
    return str(sorted(candidates, key=lambda path: path.parent.name)[-1]) if candidates else None


def certificate_digest(apksigner, apk):
    result = run(apksigner, 'verify', '--print-certs', str(apk), check=False)
    if result.returncode:
        raise RuntimeError(f'签名验证失败：{apk}\n{result.stderr or result.stdout}')
    match = re.search(r'certificate SHA-256 digest:\s*([0-9a-f:]+)', result.stdout, re.IGNORECASE)
    if not match:
        raise RuntimeError(f'无法读取签名证书 SHA-256：{apk}')
    return match.group(1).replace(':', '').lower()


def version_code(aapt, apk):
    result = run(aapt, 'dump', 'badging', str(apk), check=False)
    if result.returncode:
        raise RuntimeError(f'无法读取 versionCode：{apk}\n{result.stderr or result.stdout}')
    match = re.search(r"package:.*versionCode='(\d+)'", result.stdout)
    if not match:
        raise RuntimeError(f'APK 缺少 versionCode：{apk}')
    return int(match.group(1))


def one_device(requested):
    if not shutil.which('adb'):
        raise RuntimeError('未找到 adb。')
    output = run('adb', 'devices', '-l').stdout
    devices = []
    blocked = []
    for line in output.splitlines()[1:]:
        fields = line.split()
        if len(fields) < 2 or line.startswith('*'):
            continue
        if fields[1] == 'device':
            devices.append(fields[0])
        elif fields[1] in {'unauthorized', 'offline'}:
            blocked.append(f'{fields[0]}: {fields[1]}')
    if blocked:
        raise RuntimeError('设备未授权或离线：' + ', '.join(blocked))
    if requested:
        if requested not in devices:
            raise RuntimeError(f'指定设备不可用：{requested}')
        return requested
    if len(devices) != 1:
        raise RuntimeError(f'需要恰好一台已授权设备，当前检测到 {len(devices)} 台。')
    return devices[0]


def install(serial, apk):
    result = run('adb', '-s', serial, 'install', '-r', str(apk), check=False)
    if result.returncode:
        raise RuntimeError(f'安装失败：{apk.name}\n{result.stderr or result.stdout}')


def main():
    parser = argparse.ArgumentParser(description='验证 CCHH Mobile APK 原地升级条件')
    parser.add_argument('old_apk', type=Path)
    parser.add_argument('new_apk', type=Path)
    parser.add_argument('--install', action='store_true', help='验证通过后在一台授权设备上实际安装旧版并覆盖新版')
    parser.add_argument('--serial', help='adb 设备序列号；未指定时要求恰好一台设备')
    args = parser.parse_args()

    old_apk = args.old_apk.resolve()
    new_apk = args.new_apk.resolve()
    if not old_apk.is_file() or not new_apk.is_file():
        raise RuntimeError('旧版或新版 APK 不存在。')

    apksigner = sdk_tool('apksigner')
    aapt = sdk_tool('aapt')
    if not apksigner or not aapt:
        raise RuntimeError('需要 Android SDK build-tools 中的 apksigner 和 aapt。')

    old_digest = certificate_digest(apksigner, old_apk)
    new_digest = certificate_digest(apksigner, new_apk)
    print(f'旧版证书 SHA256: {old_digest}')
    print(f'新版证书 SHA256: {new_digest}')
    if old_digest != new_digest:
        raise RuntimeError('BLOCKED：签名证书不同，不能覆盖升级；脚本不会自动卸载旧版。')

    old_code = version_code(aapt, old_apk)
    new_code = version_code(aapt, new_apk)
    print(f'versionCode: {old_code} -> {new_code}')
    if new_code <= old_code:
        raise RuntimeError('BLOCKED：新版 versionCode 必须严格大于旧版。')

    if not args.install:
        print('PASS：签名一致且 versionCode 递增。加 --install 才会操作授权手机。')
        return 0

    serial = one_device(args.serial)
    install(serial, old_apk)
    install(serial, new_apk)
    package = run('adb', '-s', serial, 'shell', 'pm', 'path', PACKAGE, check=False).stdout.strip()
    if not package:
        raise RuntimeError('覆盖安装后未找到应用包。')
    print(f'PASS：设备 {serial} 已完成旧版到新版的 -r 覆盖安装。')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f'失败: {error}', file=sys.stderr)
        sys.exit(1)
