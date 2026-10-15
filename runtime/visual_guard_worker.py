import ctypes
import json
import queue
import sys
import threading
import time

import numpy as np
import win32con
import win32gui
import win32process
from mss import mss
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

# A frozen (PyInstaller) build inherits the OEM code page for stdio even when
# PYTHONUTF8/PYTHONIOENCODING are set, which mangles Chinese window titles on
# the wire. Pin both streams to UTF-8 instead of trusting the environment.
sys.stdin.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DWMWA_CLOAKED = 14
_dwmapi = ctypes.windll.dwmapi
_user32 = ctypes.windll.user32


class CaptureBlocked(RuntimeError):
    """Transient refusal: the target is not safely capturable right now."""


write_lock = threading.Lock()
watch_stop = threading.Event()
ocr_engine = None


def send(message):
    with write_lock:
        print(json.dumps(message, ensure_ascii=False), flush=True)


def window_info(hwnd):
    title = win32gui.GetWindowText(hwnd).strip()
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    return {
        "hwnd": hwnd,
        "title": title,
        "pid": pid,
        "rect": [left, top, right - left, bottom - top],
    }


def list_windows():
    windows = []

    def collect(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        try:
            item = window_info(hwnd)
            if item["title"] and item["rect"][2] >= 120 and item["rect"][3] >= 80:
                windows.append(item)
        except Exception:
            pass
        return True

    win32gui.EnumWindows(collect, None)
    return sorted(windows, key=lambda item: item["title"].lower())


def root_window(hwnd):
    return win32gui.GetAncestor(hwnd, win32con.GA_ROOT) or hwnd


def is_cloaked(hwnd):
    """A DWM-cloaked window belongs to another virtual desktop; it still
    reports a rect, so counting it as an occluder would refuse valid captures."""
    try:
        cloaked = ctypes.c_int(0)
        _dwmapi.DwmGetWindowAttribute(
            ctypes.c_void_p(hwnd), DWMWA_CLOAKED, ctypes.byref(cloaked), ctypes.sizeof(cloaked)
        )
        return bool(cloaked.value)
    except Exception:
        return False


def overlapping_blockers(hwnd, rect):
    """Visible top-level windows that sit above the target in Z-order and
    overlap the capture rect — i.e. something is drawn on top of it."""
    left, top, width, height = rect
    target = root_window(hwnd)
    blockers = []
    current = _user32.GetTopWindow(None)
    while current:
        if current == target:
            break
        try:
            if win32gui.IsWindowVisible(current) and not is_cloaked(current):
                other = win32gui.GetWindowRect(current)
                if (other[0] < left + width and other[2] > left
                        and other[1] < top + height and other[3] > top):
                    title = win32gui.GetWindowText(current).strip()
                    blockers.append(title or "未命名窗口")
        except Exception:
            pass
        current = _user32.GetWindow(current, win32con.GW_HWNDNEXT)
    return blockers


def gather_capture_state(hwnd, rect):
    state = {
        "exists": False, "cloaked": False, "visible": False, "minimized": False,
        "foreground": False, "blockers": [], "rect": rect,
    }
    if not win32gui.IsWindow(hwnd):
        return state
    state["exists"] = True
    state["cloaked"] = is_cloaked(hwnd)
    state["visible"] = bool(win32gui.IsWindowVisible(hwnd))
    state["minimized"] = bool(win32gui.IsIconic(hwnd))
    state["foreground"] = root_window(win32gui.GetForegroundWindow()) == root_window(hwnd)
    state["blockers"] = overlapping_blockers(hwnd, rect)
    return state


def evaluate_capture_state(state):
    """Pure decision: returns a Chinese refusal reason, or None when the target
    is safe to capture. Fails closed on every unknown."""
    if not state["exists"]:
        return "目标窗口已关闭"
    if state["cloaked"]:
        return "目标窗口不在当前桌面，已暂停识别。"
    if not state["visible"]:
        return "目标窗口已隐藏，已暂停识别。"
    if state["minimized"]:
        return "目标窗口已最小化，已暂停识别。"
    if not state["foreground"]:
        return "目标窗口不在前台或存在遮挡，已暂停识别。"
    if state["blockers"]:
        return f"目标窗口被「{state['blockers'][0]}」遮挡，已暂停识别。"
    return None


def capture_rect(hwnd, region):
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width, height = right - left, bottom - top
    if region:
        x, y, width, height = map(int, region)
        left += x
        top += y
    if width <= 0 or height <= 0:
        raise RuntimeError("截图区域无效")
    return [left, top, width, height]


def capture(hwnd, region=None):
    rect = capture_rect(hwnd, region)
    reason = evaluate_capture_state(gather_capture_state(hwnd, rect))
    if reason:
        raise CaptureBlocked(reason)
    with mss() as grabber:
        shot = grabber.grab({"left": rect[0], "top": rect[1], "width": rect[2], "height": rect[3]})
    image = Image.frombytes("RGB", shot.size, shot.rgb)
    # The screen can change mid-grab; a capture taken while the target lost the
    # foreground (or gained an occluder) shows someone else's pixels, so drop it.
    after = gather_capture_state(hwnd, capture_rect(hwnd, region))
    reason = evaluate_capture_state(after)
    if reason or after["rect"] != rect:
        raise CaptureBlocked("截图期间窗口状态发生变化，本次结果已丢弃。")
    return image


def see(hwnd, region=None, wait_seconds=0):
    """Read the window as positioned text.

    Returns every recognized line with its box in *screen* coordinates, so the
    caller can both read the window and act on what it read without a vision
    model or a pixel guess.
    """
    global ocr_engine
    if ocr_engine is None:
        ocr_engine = RapidOCR()
    origin_left, origin_top, _, _ = capture_rect(hwnd, region)
    image = capture_when_ready(hwnd, region, wait_seconds)
    result, _ = ocr_engine(np.asarray(image))
    lines = []
    for box, text, score in result or []:
        text = text.strip()
        if score < 0.45 or not text:
            continue
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        lines.append({
            "text": text,
            "score": round(float(score), 3),
            "box": [
                int(origin_left + min(xs)), int(origin_top + min(ys)),
                int(max(xs) - min(xs)), int(max(ys) - min(ys)),
            ],
            "center": [int(origin_left + sum(xs) / len(xs)), int(origin_top + sum(ys) / len(ys))],
            "_top": min(ys),
        })
    lines.sort(key=lambda item: (item["_top"], item["box"][0]))
    for item in lines:
        item.pop("_top")
    return {
        "window": window_info(hwnd),
        "region": region,
        "width": image.width,
        "height": image.height,
        "lines": lines,
        "text": "\n".join(item["text"] for item in lines),
    }


def find(hwnd, query, region=None, wait_seconds=0):
    """Locate a substring on screen and return where to act on it."""
    query = (query or "").strip()
    if not query:
        raise RuntimeError("请提供要查找的文字")
    seen = see(hwnd, region, wait_seconds)
    needle = query.casefold()
    matches = [line for line in seen["lines"] if needle in line["text"].casefold()]
    return {"query": query, "matches": matches, "window": seen["window"]}


def select_region(hwnd):
    import tkinter as tk

    if not win32gui.IsWindow(hwnd):
        raise RuntimeError("目标窗口已关闭")
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    selected = queue.Queue(maxsize=1)
    root = tk.Tk()
    root.overrideredirect(True)
    root.attributes("-topmost", True)
    root.attributes("-alpha", 0.32)
    root.geometry(f"{right-left}x{bottom-top}+{left}+{top}")
    canvas = tk.Canvas(root, bg="#111827", cursor="cross")
    canvas.pack(fill="both", expand=True)
    canvas.create_text(12, 12, anchor="nw", fill="white", text="拖动框选消息区；Esc 取消")
    start = [0, 0]

    def begin(event):
        start[:] = [event.x, event.y]

    def drag(event):
        canvas.delete("selection")
        canvas.create_rectangle(*start, event.x, event.y, outline="#ef4444", width=3, tags="selection")

    def finish(event):
        x, y = min(start[0], event.x), min(start[1], event.y)
        width, height = abs(event.x - start[0]), abs(event.y - start[1])
        if width >= 20 and height >= 20:
            selected.put([x, y, width, height])
        root.destroy()

    canvas.bind("<Button-1>", begin)
    canvas.bind("<B1-Motion>", drag)
    canvas.bind("<ButtonRelease-1>", finish)
    root.bind("<Escape>", lambda _event: root.destroy())
    root.mainloop()
    if selected.empty():
        raise RuntimeError("已取消框选")
    return selected.get()


def capture_when_ready(hwnd, region, wait_seconds):
    """A manual capture is started by a click, and that click necessarily put
    the app itself in front. Waiting for the target to come back keeps the
    guard intact instead of weakening it for the interactive case."""
    deadline = time.monotonic() + max(0.0, float(wait_seconds))
    while True:
        try:
            return capture(hwnd, region)
        except CaptureBlocked:
            if time.monotonic() >= deadline:
                raise
            if watch_stop.wait(0.4):
                raise CaptureBlocked("已取消识别。")


def handle(command):
    action = command.get("action")
    args = command.get("args") or {}
    wait = min(30.0, max(0.0, float(args.get("wait_seconds") or 0)))
    if action == "ping":
        return {"ready": True}
    if action == "windows":
        return list_windows()
    if action == "see":
        return see(int(args["hwnd"]), args.get("region"), wait)
    if action == "find":
        return find(int(args["hwnd"]), args.get("query"), args.get("region"), wait)
    if action == "select_region":
        return {"region": select_region(int(args["hwnd"]))}
    if action == "shutdown":
        watch_stop.set()
        return {"state": "shutdown"}
    raise RuntimeError(f"未知操作：{action}")


def selftest():
    """Non-interactive check of the capture guard: pure state machine only, no
    window is touched."""
    ok = {"exists": True, "cloaked": False, "visible": True, "minimized": False,
          "foreground": True, "blockers": [], "rect": [0, 0, 10, 10]}
    assert evaluate_capture_state(ok) is None
    cases = [
        ({"exists": False}, "已关闭"),
        ({"cloaked": True}, "不在当前桌面"),
        ({"visible": False}, "已隐藏"),
        ({"minimized": True}, "已最小化"),
        ({"foreground": False}, "不在前台"),
        ({"blockers": ["微信"]}, "遮挡"),
    ]
    for patch, expected in cases:
        state = {**ok, **patch}
        reason = evaluate_capture_state(state)
        assert reason and expected in reason, (patch, reason)
    print("PASS: foreground window is capturable")
    print("PASS: closed / cloaked / hidden / minimized / background / occluded are all refused")
    return 0


if "--selftest" in sys.argv:
    raise SystemExit(selftest())

for raw in sys.stdin:
    request = None
    try:
        request = json.loads(raw)
        result = handle(request)
        send({"id": request.get("id"), "ok": True, "result": result})
        if request.get("action") == "shutdown":
            break
    except Exception as error:
        send({"id": request.get("id") if request else None, "ok": False, "error": str(error)})
