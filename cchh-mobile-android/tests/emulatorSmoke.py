#!/usr/bin/env python3
"""Drive the installed CCHH Mobile APK in an Android emulator.

Modes:
  connect                     launch and assert the connection screen
  resume                      HOME -> relaunch and assert the screen survives
  chat <base-url> <h5-token>  connect, send one message, verify the reply,
                              then relaunch and verify the transcript reloads

Every mode dismisses a launcher ANR dialog before reading the UI hierarchy;
that dialog otherwise hides the app's real content from uiautomator.
"""
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = "com.cchh.mobile.client"
TITLES = ("CCHH Mobile", "连接我自己的 CCHH")
DIALOG_MARKERS = ("isn't responding", "无响应")
DIALOG_ACTIONS = ("Wait", "等待", "Close app", "关闭应用")


def sh(*args: str) -> str:
    return subprocess.run(["adb", *args], check=True, capture_output=True, text=True).stdout


def dump() -> ET.Element:
    # uiautomator occasionally returns an empty or stale file while the system
    # UI is busy; retry rather than aborting the whole smoke.
    for _ in range(5):
        sh("shell", "uiautomator", "dump", "/data/local/tmp/cchh-smoke.xml")
        raw = sh("exec-out", "cat", "/data/local/tmp/cchh-smoke.xml")
        start = raw.find("<")
        if start > -1:
            try:
                return ET.fromstring(raw[start:])
            except ET.ParseError:
                pass
        time.sleep(1.5)
    raise SystemExit("uiautomator dump did not return XML")


def texts(root: ET.Element):
    return [node.get("text") or "" for node in root.iter("node")]


def find(root: ET.Element, needle: str):
    for node in root.iter("node"):
        if needle in (node.get("text") or ""):
            return node
    return None


def find_label(root: ET.Element, needle: str):
    for node in root.iter("node"):
        if any(needle in (node.get(field) or "") for field in ("text", "content-desc")):
            return node
    return None


def find_class(root: ET.Element, cls: str, index: int = 0):
    found = [node for node in root.iter("node") if node.get("class") == cls]
    return found[index] if len(found) > index else None


def bounds(node) -> tuple[int, int, int, int]:
    return tuple(int(value) for value in re.findall(r"-?\d+", node.get("bounds")))


def tap_node(node) -> None:
    x1, y1, x2, y2 = bounds(node)
    sh("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))


def dismiss_dialogs(root: ET.Element) -> bool:
    joined = "\n".join(texts(root))
    if not any(marker in joined for marker in DIALOG_MARKERS):
        return False
    for action in DIALOG_ACTIONS:
        node = find(root, action)
        if node is not None:
            tap_node(node)
            time.sleep(2)
            return True
    sh("shell", "input", "keyevent", "4")
    time.sleep(2)
    return True


def wait_for(predicate, label: str, timeout: float = 45.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        root = dump()
        if dismiss_dialogs(root):
            continue
        value = predicate(root)
        if value is not None:
            return value
        time.sleep(2)
    raise SystemExit(f"timed out waiting for {label}")


def save(root: ET.Element, xml_path: str, png_path: str) -> None:
    with open(xml_path, "w", encoding="utf-8") as handle:
        handle.write(ET.tostring(root, encoding="unicode"))
    with open(png_path, "wb") as handle:
        handle.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], check=True, capture_output=True).stdout)


def launch() -> None:
    sh("shell", "am", "force-stop", PACKAGE)
    sh("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")


def on_connect_screen(root: ET.Element):
    return root if any(find(root, title) is not None for title in TITLES) else None


def swipe_up() -> None:
    sh("shell", "input", "swipe", "540", "1900", "540", "700", "300")
    time.sleep(1)


def type_text(value: str) -> None:
    # Inject in small chunks and let the field settle; one long injection can
    # lose trailing characters when the IME is still starting up. Spaces are
    # sent as %s, which adb's input command expands literally.
    for index, token in enumerate(value.split(' ')):
        if index:
            sh("shell", "input", "text", "%s")
            time.sleep(0.2)
        for start in range(0, len(token), 4):
            sh("shell", "input", "text", token[start:start + 4])
            time.sleep(0.35)
    time.sleep(0.8)
    # Escape dismisses the IME without exercising the app's BackHandler.
    sh("shell", "input", "keyevent", "111")
    time.sleep(0.8)


def secret_length(root: ET.Element) -> int:
    for node in root.iter("node"):
        if node.get("class") == "android.widget.EditText" and node.get("password") == "true":
            return len(node.get("text") or "")
    return -1


def clear_field(node) -> None:
    tap_node(node)
    sh("shell", "input", "keyevent", *(["67"] * 400))
    time.sleep(0.8)


def input_value(root: ET.Element) -> str:
    node = find_class(root, "android.widget.EditText")
    return (node.get("text") or "") if node is not None else ""


def wait_focused() -> None:
    deadline = time.time() + 6
    while time.time() < deadline:
        root = dump()
        if any(node.get("class") == "android.widget.EditText" and node.get("focused") == "true" for node in root.iter("node")):
            return
        time.sleep(0.5)
    # uiautomator sometimes omits focus; give the IME a fixed settle window.
    time.sleep(1)


def type_exact(value: str, label: str) -> None:
    # Injected keys occasionally arrive out of order; verify and retry.
    for _ in range(3):
        composer = wait_for(lambda root: find_class(root, "android.widget.EditText"), label)
        tap_node(composer)
        wait_focused()
        type_text(value)
        if input_value(dump()) == value:
            return
        node = find_class(dump(), "android.widget.EditText")
        if node is not None:
            clear_field(node)
    raise SystemExit(f"{label} input did not match")


def mode_connect() -> None:
    launch()
    root = wait_for(on_connect_screen, "connection screen")
    save(root, "cchh-mobile-ui.xml", "cchh-mobile-smoke.png")


def mode_resume() -> None:
    sh("shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(4)
    sh("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    time.sleep(4)
    root = wait_for(on_connect_screen, "connection screen after resume")
    save(root, "cchh-mobile-resume-ui.xml", "cchh-mobile-resume.png")


def mode_chat(base_url: str, token: str, info_path: str) -> None:
    try:
        chat_flow(base_url, token, info_path)
    except BaseException:
        # Keep the failing screen and log for artifact review.
        try:
            save(dump(), "cchh-mobile-chat-failure.xml", "cchh-mobile-chat-failure.png")
            with open("cchh-chat-logcat.txt", "w", encoding="utf-8") as handle:
                handle.write(sh("logcat", "-d", "-v", "time"))
        except Exception:
            pass
        raise


def chat_flow(base_url: str, token: str, info_path: str) -> None:
    launch()
    root = wait_for(on_connect_screen, "connection screen")
    inputs = [node for node in root.iter("node") if node.get("class") == "android.widget.EditText"]
    for _ in range(3):
        if len(inputs) >= 2:
            break
        swipe_up()
        root = dump()
        inputs = [node for node in root.iter("node") if node.get("class") == "android.widget.EditText"]
    if len(inputs) < 2:
        raise SystemExit("connect screen must expose address and token inputs")

    tap_node(inputs[0])
    wait_focused()
    type_text(base_url)
    root = wait_for(lambda value: value if find_class(value, "android.widget.EditText", 1) is not None else None, "token input")
    tap_node(find_class(root, "android.widget.EditText", 1))
    wait_focused()
    type_text(token)
    root = dump()
    if secret_length(root) != len(token):
        clear_field(find_class(root, "android.widget.EditText", 1))
        type_text(token)
        root = dump()
        if secret_length(root) != len(token):
            raise SystemExit(f"token entry incomplete ({secret_length(root)}/{len(token)})")
    connect = wait_for(lambda value: value if find(value, "连接到 CCHH") is not None else None, "connect button")
    tap_node(find(connect, "连接到 CCHH"))

    sessions = wait_for(lambda value: value if find(value, "Untitled Session") is not None else None, "session list")
    tap_node(find(sessions, "Untitled Session"))
    wait_for(lambda value: value if find(value, "CCHH Mobile") is not None and find_class(value, "android.widget.EditText") is not None else None, "new chat workbench")
    # Exercise real five-tab rendering/taps before sending. These are never mocked screens.
    for tab, title in (("任务", "当前执行"), ("终端", "只读"), ("文件", "刷新文件"), ("桌面", "电脑连接")):
        root = wait_for(lambda value: value if find(value, tab) is not None else None, f"{tab} tab")
        tap_node(find(root, tab))
        wait_for(lambda value: value if find(value, title) is not None else None, f"{tab} page")
    root = wait_for(lambda value: value if find(value, "聊天") is not None else None, "chat tab")
    tap_node(find(root, "聊天"))
    wait_for(lambda value: value if find_class(value, "android.widget.EditText") is not None else None, "chat composer")
    # The send button stays disabled until sync_state and history complete.
    wait_for(lambda value: value if find(value, "已连接") is not None else None, "connected session state")

    type_exact("helloE2E", "message input")
    send = wait_for(lambda value: value if find_label(value, "发送消息") is not None else None, "send button")
    tap_node(find_label(send, "发送消息"))
    wait_for(lambda value: value if find(value, "Echo: helloE2E") is not None else None, "assistant reply", timeout=60)

    # A tool call must reach the desktop, wait for the phone's decision, and
    # only run after "本次批准" is tapped.
    approval_path = '/tmp/cchh-mobile-e2e-approved.txt'
    try:
        os.remove(approval_path)
    except FileNotFoundError:
        pass
    payload = 'MOCK_TOOL ' + json.dumps({
        'tool': 'Write',
        'input': {'file_path': approval_path, 'content': 'approved'},
        'write': {'path': approval_path, 'content': 'approved'},
        'reply': 'APPROVED_E2E',
    }, separators=(',', ':'))
    # adb input cannot type braces/quotes, so the host sends this turn.
    sender = subprocess.Popen(
        ['node', 'cchh-mobile-android/tests/sendTurn.mjs', info_path, payload],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    approve = wait_for(lambda value: value if find(value, "本次批准") is not None else None, "approval prompt", timeout=60)
    tap_node(find(approve, "本次批准"))
    deadline = time.time() + 45
    while time.time() < deadline:
        if os.path.exists(approval_path):
            with open(approval_path, encoding='utf-8') as handle:
                if handle.read() == 'approved':
                    break
        time.sleep(1)
    else:
        raise SystemExit("approved tool did not run on the desktop")
    if sender.wait(timeout=90) != 0:
        raise SystemExit("host turn sender failed")

    # Real foreground round-trip: leave the app, come back, and confirm the
    # transcript still loads over a freshly authenticated connection.
    sh("shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(4)
    sh("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    time.sleep(4)
    resumed = wait_for(
        lambda value: value if find(value, "Echo: helloE2E") is not None or find(value, "Untitled Session") is not None else None,
        "resumed transcript",
    )
    if find(resumed, "Echo: helloE2E") is None:
        tap_node(find(resumed, "Untitled Session"))
        wait_for(lambda value: value if find(value, "Echo: helloE2E") is not None else None, "reply after resume", timeout=60)

    # Airplane mode drops the transport; the app must reconnect without
    # replaying the task, and a new turn must work over the restored socket.
    sh("shell", "cmd", "connectivity", "airplane-mode", "enable")
    wait_for(lambda value: value if find(value, "正在重连") is not None else None, "reconnect state", timeout=150)
    sh("shell", "cmd", "connectivity", "airplane-mode", "disable")
    recovered = wait_for(lambda value: value if find(value, "已连接") is not None else None, "reconnected state", timeout=90)
    copies = sum(1 for node in recovered.iter("node") if node.get("text") == "helloE2E")
    if copies != 1:
        raise SystemExit(f"task was replayed after reconnect ({copies} copies)")
    sender = subprocess.Popen(
        ['node', 'cchh-mobile-android/tests/sendTurn.mjs', info_path, 'afterReconnect'],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    wait_for(lambda value: value if find(value, "Echo: afterReconnect") is not None else None, "reply after reconnect", timeout=60)
    if sender.wait(timeout=90) != 0:
        raise SystemExit("post-reconnect turn sender failed")
    print("EMULATOR_CHAT_SMOKE_PASSED")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "connect"
    if mode == "connect":
        mode_connect()
    elif mode == "resume":
        mode_resume()
    elif mode == "chat":
        mode_chat(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "cchh-e2e-info.json")
    elif mode == "chat-info":
        import json
        with open(sys.argv[2], encoding="utf-8") as handle:
            info = json.load(handle)
        mode_chat(f"http://10.0.2.2:{info['port']}", info["token"], sys.argv[2])
    else:
        raise SystemExit(f"unknown mode: {mode}")


if __name__ == "__main__":
    main()
