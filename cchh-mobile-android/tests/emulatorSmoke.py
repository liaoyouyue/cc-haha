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
    sh("shell", "uiautomator", "dump", "/data/local/tmp/cchh-smoke.xml")
    return ET.fromstring(sh("exec-out", "cat", "/data/local/tmp/cchh-smoke.xml"))


def texts(root: ET.Element):
    return [node.get("text") or "" for node in root.iter("node")]


def find(root: ET.Element, needle: str):
    for node in root.iter("node"):
        if needle in (node.get("text") or ""):
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
    sh("shell", "input", "text", value)
    # Escape dismisses the IME without exercising the app's BackHandler.
    sh("shell", "input", "keyevent", "111")
    time.sleep(1)


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


def mode_chat(base_url: str, token: str) -> None:
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
    type_text(base_url)
    root = wait_for(lambda value: value if find_class(value, "android.widget.EditText", 1) is not None else None, "token input")
    tap_node(find_class(root, "android.widget.EditText", 1))
    type_text(token)
    connect = wait_for(lambda value: value if find(value, "连接到 CCHH") is not None else None, "connect button")
    tap_node(find(connect, "连接到 CCHH"))

    sessions = wait_for(lambda value: value if find(value, "Untitled Session") is not None else None, "session list")
    tap_node(find(sessions, "Untitled Session"))
    wait_for(lambda value: value if find(value, "给家里的 CCHH 发送任务") is not None else None, "chat composer")

    composer = wait_for(lambda value: find_class(value, "android.widget.EditText"), "message input")
    tap_node(composer)
    type_text("helloE2E")
    send = wait_for(lambda value: value if find(value, "发送") is not None else None, "send button")
    tap_node(find(send, "发送"))
    wait_for(lambda value: value if find(value, "Echo: helloE2E") is not None else None, "assistant reply", timeout=60)

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
    print("EMULATOR_CHAT_SMOKE_PASSED")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "connect"
    if mode == "connect":
        mode_connect()
    elif mode == "resume":
        mode_resume()
    elif mode == "chat":
        mode_chat(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(f"unknown mode: {mode}")


if __name__ == "__main__":
    main()
