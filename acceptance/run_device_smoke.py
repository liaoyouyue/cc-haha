#!/usr/bin/env python3
"""Verify, install, launch, and capture evidence from one authorized Android phone."""

import argparse
import hashlib
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

PACKAGE = 'com.cchh.mobile.client'
ACTIVITY = f'{PACKAGE}/.MainActivity'


def run(*args, check=True, text=True):
    options = {'text': True, 'encoding': 'utf-8', 'errors': 'replace'} if text else {'text': False}
    return subprocess.run(args, check=check, capture_output=True, **options)


def adb(serial, *args, check=True, text=True):
    return run('adb', '-s', serial, *args, check=check, text=text)


def connected_device():
    if not shutil.which('adb'):
        raise RuntimeError('未找到 adb。请安装 Android Platform Tools 并加入 PATH。')
    output = run('adb', 'devices', '-l').stdout
    devices = []
    blocked = []
    for line in output.splitlines()[1:]:
        fields = line.split()
        if len(fields) < 2 or line.startswith('*'):
            continue
        serial, state = fields[:2]
        if state == 'device':
            devices.append(serial)
        elif state in {'unauthorized', 'offline'}:
            blocked.append(f'{serial}: {state}')
    if blocked:
        raise RuntimeError('设备未授权或离线：' + ', '.join(blocked) + '。解锁手机并确认 USB 调试授权。')
    if len(devices) != 1:
        raise RuntimeError(f'需要恰好一台已授权设备，当前检测到 {len(devices)} 台。')
    return devices[0]


def expected_sha256(apk, supplied):
    if supplied:
        return supplied.lower()
    sums = apk.parent / 'SHA256SUMS.txt'
    if sums.exists():
        return sums.read_text(encoding='utf-8').split()[0].lower()
    raise RuntimeError('缺少预期 SHA256；请传 --sha256 或把 SHA256SUMS.txt 放在 APK 同目录。')


def verify_sha256(apk, expected):
    digest = hashlib.sha256()
    with apk.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual != expected:
        raise RuntimeError(f'APK SHA256 不一致。\n预期: {expected}\n实际: {actual}')
    print(f'APK SHA256: {actual}')


def device_property(serial, name):
    return adb(serial, 'shell', 'getprop', name).stdout.strip()


def wait_for_text(serial, text, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        adb(serial, 'shell', 'uiautomator', 'dump', '/data/local/tmp/cchh-window.xml', check=False)
        result = adb(serial, 'exec-out', 'cat', '/data/local/tmp/cchh-window.xml', check=False)
        if result.returncode == 0 and text in result.stdout:
            return True
        time.sleep(1)
    return False


def capture(serial, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    screenshot = adb(serial, 'exec-out', 'screencap', '-p', text=False)
    if screenshot.returncode == 0:
        (output_dir / 'launch.png').write_bytes(screenshot.stdout)
    adb(serial, 'shell', 'uiautomator', 'dump', '/data/local/tmp/cchh-window.xml', check=False)
    adb(serial, 'pull', '/data/local/tmp/cchh-window.xml', str(output_dir / 'window.xml'), check=False)
    logcat = adb(serial, 'logcat', '-d', '-v', 'time', check=False)
    (output_dir / 'logcat.txt').write_text(logcat.stdout, encoding='utf-8', errors='replace')


def print_manual_steps(mode, serial):
    print('\n手机操作：')
    if mode == 'lan':
        print('1. 手机和测试电脑连接同一个可信 Wi-Fi。')
        print('2. APP 选择“同一 Wi-Fi”，扫描电脑 CCHH“设置 → H5 访问”的二维码。')
    elif mode == 'tailscale':
        print('1. 手机和测试电脑加入同一个 Tailscale 网络。')
        print('2. APP 选择“Tailscale”，扫码后确认地址是这台电脑的 100.x 地址。')
    else:
        print('1. APP 选择“公网 ngrok”，扫描一次性配对二维码。')
        print('2. 电脑批准设备后，手机点“检查审批并连接”。')
    print('3. 进入会话，发送唯一测试文本，确认只出现一次并收到回复。')
    print('4. 发起无害工具调用；手机先核对内容，再点“本次批准”。')
    print('5. HOME 键切后台再回来；锁屏 30 秒再解锁；确认历史保留并自动重连。')
    print('6. 如需测网络切换，请人工切换；恢复后先查历史，避免重复发送。')
    print('\n安全回退：')
    print('- 手机 APP 点“解除配对”。')
    print('- 电脑关闭 H5 访问或轮换 H5 令牌；公网模式再撤销该设备。')
    print(f'- 仅需移除测试 APP 时执行：adb -s {serial} uninstall {PACKAGE}')
    print('- 不删除电脑会话、数据库或其他 CCHH 数据。')


def main():
    parser = argparse.ArgumentParser(description='CCHH Mobile 单真机验收准备')
    parser.add_argument('apk', type=Path, help='待测 APK 路径')
    parser.add_argument('--sha256', help='完整预期 SHA256；默认读取 APK 同目录 SHA256SUMS.txt')
    parser.add_argument('--mode', choices=('lan', 'tailscale', 'ngrok'), default='lan')
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()

    apk = args.apk.resolve()
    if not apk.is_file():
        raise RuntimeError(f'APK 不存在：{apk}')
    verify_sha256(apk, expected_sha256(apk, args.sha256))

    serial = connected_device()
    manufacturer = device_property(serial, 'ro.product.manufacturer')
    model = device_property(serial, 'ro.product.model')
    api = device_property(serial, 'ro.build.version.sdk')
    print(f'设备: {manufacturer} {model} / API {api} / {serial}')

    install = adb(serial, 'install', '-r', str(apk), check=False)
    if install.returncode != 0:
        raise RuntimeError('APK 安装失败：' + (install.stderr or install.stdout).strip())
    adb(serial, 'logcat', '-c', check=False)
    adb(serial, 'shell', 'am', 'force-stop', PACKAGE)
    launch = adb(serial, 'shell', 'am', 'start', '-n', ACTIVITY, check=False)
    if launch.returncode != 0:
        raise RuntimeError('APP 启动失败：' + (launch.stderr or launch.stdout).strip())
    time.sleep(3)
    pid = adb(serial, 'shell', 'pidof', PACKAGE, check=False).stdout.strip()
    if not pid:
        raise RuntimeError('APP 启动后没有进程；请查看 logcat。')

    output_dir = args.output_dir or Path(__file__).parent / f'device-smoke-{datetime.now():%Y%m%d-%H%M%S}'
    welcome_found = wait_for_text(serial, '连接我自己的 CCHH')
    capture(serial, output_dir)
    if not welcome_found:
        raise RuntimeError(f'未找到首次连接页。证据已保存到 {output_dir}')

    print(f'自动检查通过：已安装、启动并显示首次连接页；PID {pid}')
    print(f'证据目录: {output_dir}')
    print('logcat 可能含本机路径；分享前请人工检查。脚本不会读取或打印 H5 令牌。')
    print_manual_steps(args.mode, serial)
    print('\n注意：以上只代表自动准备通过；真机 LAN/恢复/审批结果仍需人工记录。')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.SubprocessError, OSError) as error:
        print(f'失败: {error}', file=sys.stderr)
        sys.exit(1)
