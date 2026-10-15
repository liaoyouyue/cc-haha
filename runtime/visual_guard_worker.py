import ctypes
import json
import os
import queue
import sys
import threading
import time
import traceback

import numpy as np
import win32con
import win32gui
import win32process
from mss import mss
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

try:
    import uiautomation
except Exception:  # the Python fallback may not have it; OCR still works
    uiautomation = None

# A frozen (PyInstaller) build inherits the OEM code page for stdio even when
# PYTHONUTF8/PYTHONIOENCODING are set, which mangles Chinese window titles on
# the wire. Pin both streams to UTF-8 instead of trusting the environment.
sys.stdin.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DWMWA_CLOAKED = 14
# Renders the window's own content into the DC, so it works whether or not the
# window is in front. Plain PrintWindow (flag 0) comes back all black for
# modern/DirectComposition windows that this flag handles.
PW_RENDERFULLCONTENT = 0x00000002
SRCCOPY = 0x00CC0020
DIB_RGB_COLORS = 0
_dwmapi = ctypes.windll.dwmapi
_user32 = ctypes.windll.user32
_gdi32 = ctypes.windll.gdi32


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", ctypes.c_uint32), ("biWidth", ctypes.c_int32), ("biHeight", ctypes.c_int32),
        ("biPlanes", ctypes.c_uint16), ("biBitCount", ctypes.c_uint16), ("biCompression", ctypes.c_uint32),
        ("biSizeImage", ctypes.c_uint32), ("biXPelsPerMeter", ctypes.c_int32), ("biYPelsPerMeter", ctypes.c_int32),
        ("biClrUsed", ctypes.c_uint32), ("biClrImportant", ctypes.c_uint32),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", ctypes.c_uint32 * 3)]


def declare_win32_types():
    """ctypes defaults every argument to a 32-bit int and every return to int.

    Window and GDI handles are pointer-sized, so a handle above 2**31 raises
    "OverflowError: int too long to convert" — which only shows up once a run
    happens to hand out a large handle. Declaring the types makes the calls
    correct in every build instead of correct by luck.
    """
    from ctypes import wintypes as wt
    handles = dict(
        GetTopWindow=(wt.HWND, [wt.HWND]),
        GetWindow=(wt.HWND, [wt.HWND, wt.UINT]),
        GetWindowDC=(wt.HDC, [wt.HWND]),
        ReleaseDC=(ctypes.c_int, [wt.HWND, wt.HDC]),
        PrintWindow=(wt.BOOL, [wt.HWND, wt.HDC, wt.UINT]),
        CreateCompatibleDC=(wt.HDC, [wt.HDC]),
        CreateCompatibleBitmap=(wt.HBITMAP, [wt.HDC, ctypes.c_int, ctypes.c_int]),
        SelectObject=(wt.HGDIOBJ, [wt.HDC, wt.HGDIOBJ]),
        DeleteObject=(wt.BOOL, [wt.HGDIOBJ]),
        DeleteDC=(wt.BOOL, [wt.HDC]),
        GetDIBits=(ctypes.c_int, [wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT,
                                 ctypes.c_void_p, ctypes.POINTER(BITMAPINFO), wt.UINT]),
        DwmGetWindowAttribute=(ctypes.c_long, [wt.HWND, wt.DWORD, ctypes.c_void_p, wt.DWORD]),
    )
    for name, (restype, argtypes) in handles.items():
        for lib in (_user32, _gdi32, _dwmapi):
            if hasattr(lib, name):
                function = getattr(lib, name)
                function.restype = restype
                function.argtypes = argtypes


declare_win32_types()


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


def evaluate_capture_state(state, require_front=True):
    """Pure decision: returns a Chinese refusal reason, or None when the target
    is safe to capture. Fails closed on every unknown.

    require_front is False only for the self-render path, where the window
    supplies its own pixels and Z-order cannot change what is read."""
    if not state["exists"]:
        return "目标窗口已关闭"
    if state["cloaked"]:
        return "目标窗口不在当前桌面，已暂停识别。"
    if not state["visible"]:
        return "目标窗口已隐藏，已暂停识别。"
    if state["minimized"]:
        return "目标窗口已最小化，已暂停识别。"
    if not require_front:
        return None
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


def render_window(hwnd):
    """Ask the window to draw itself into a bitmap. Independent of Z-order, so
    a covered or background window still yields its own pixels. Returns None
    when the window refuses to render (some layered/hardware surfaces come back
    uniformly blank)."""
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width, height = right - left, bottom - top
    if width <= 0 or height <= 0:
        return None
    window_dc = _user32.GetWindowDC(hwnd)
    memory_dc = _gdi32.CreateCompatibleDC(window_dc)
    bitmap = _gdi32.CreateCompatibleBitmap(window_dc, width, height)
    try:
        _gdi32.SelectObject(memory_dc, bitmap)
        if not _user32.PrintWindow(hwnd, memory_dc, PW_RENDERFULLCONTENT):
            return None
        header = BITMAPINFO()
        header.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        header.bmiHeader.biWidth = width
        header.bmiHeader.biHeight = -height
        header.bmiHeader.biPlanes = 1
        header.bmiHeader.biBitCount = 32
        buffer = ctypes.create_string_buffer(width * height * 4)
        if not _gdi32.GetDIBits(memory_dc, bitmap, 0, height, buffer, ctypes.byref(header), DIB_RGB_COLORS):
            return None
    finally:
        _gdi32.DeleteObject(bitmap)
        _gdi32.DeleteDC(memory_dc)
        _user32.ReleaseDC(hwnd, window_dc)
    array = np.frombuffer(buffer, dtype=np.uint8).reshape(height, width, 4)[:, :, :3]
    if float(array.std()) < 1.0 and float(array.mean()) < 8:
        return None  # a uniformly blank render is a refusal, not a picture
    return Image.fromarray(array[:, :, ::-1])


def crop(image, region):
    if not region:
        return image
    x, y, width, height = map(int, region)
    return image.crop((x, y, x + width, y + height))


def capture(hwnd, region=None):
    """Read the window's own content when it will render itself; otherwise fall
    back to a screen grab, which is only trustworthy while the window is in
    front and unobstructed."""
    state = gather_capture_state(hwnd, capture_rect(hwnd, region))
    reason = evaluate_capture_state(state, require_front=False)
    if reason:
        raise CaptureBlocked(reason)

    rendered = render_window(hwnd)
    if rendered is not None:
        return crop(rendered, region)

    # No self-render: only a foreground, unobstructed screen grab shows this
    # window's pixels rather than whatever is drawn over it.
    reason = evaluate_capture_state(state)
    if reason:
        raise CaptureBlocked(f"{reason}（该窗口不支持后台读取，需置于前台）")
    rect = capture_rect(hwnd, region)
    with mss() as grabber:
        shot = grabber.grab({"left": rect[0], "top": rect[1], "width": rect[2], "height": rect[3]})
    image = Image.frombytes("RGB", shot.size, shot.rgb)
    after = gather_capture_state(hwnd, capture_rect(hwnd, region))
    reason = evaluate_capture_state(after)
    if reason or after["rect"] != rect:
        raise CaptureBlocked("截图期间窗口状态发生变化，本次结果已丢弃。")
    return image


CLICKABLE_ROLES = {
    "ButtonControl", "EditControl", "HyperlinkControl", "MenuItemControl",
    "ListItemControl", "TabItemControl", "CheckBoxControl", "RadioButtonControl",
    "ComboBoxControl", "SplitButtonControl", "TreeItemControl", "TextControl",
}


def read_controls(hwnd, budget=400):
    """The window's control tree: role, accessible name, screen rectangle.

    This is the authoritative read when an app exposes one — it names controls
    that carry no visible text and says which of them can be acted on. Some
    apps expose nothing, which is why the OCR pass still runs.
    """
    if uiautomation is None:
        return []
    rows = []
    seen = set()

    def walk(control, depth):
        if len(rows) >= budget or depth > 40:
            return
        for child in control.GetChildren():
            if len(rows) >= budget:
                return
            try:
                rect = child.BoundingRectangle
                role = child.ControlTypeName
                name = (child.Name or "").strip()
            except Exception:
                continue
            key = (role, name, rect.left, rect.top, rect.right, rect.bottom)
            if key not in seen:
                seen.add(key)
                width, height = rect.right - rect.left, rect.bottom - rect.top
                if name or role in CLICKABLE_ROLES:
                    rows.append({
                        "role": role,
                        "name": name,
                        "clickable": role in CLICKABLE_ROLES,
                        "box": [int(rect.left), int(rect.top), int(width), int(height)],
                        "center": [int((rect.left + rect.right) / 2), int((rect.top + rect.bottom) / 2)],
                        "source": "uia",
                        "depth": depth,
                    })
            walk(child, depth + 1)

    try:
        walk(uiautomation.ControlFromHandle(hwnd), 1)
    except Exception:
        return []
    rows.sort(key=lambda item: (item["box"][1], item["box"][0]))
    return rows


def read_text(hwnd, region, wait_seconds):
    """OCR pass: positioned text for apps that expose no control tree, and for
    text drawn inside a single control the tree cannot break apart."""
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
            "source": "ocr",
            "_top": min(ys),
        })
    lines.sort(key=lambda item: (item["_top"], item["box"][0]))
    for item in lines:
        item.pop("_top")
    return image, lines


def see(hwnd, region=None, wait_seconds=0):
    """Read the window as positioned text, in screen coordinates.

    Two independent reads, returned side by side rather than merged: the
    control tree names things and says what is actionable, OCR catches text
    the tree cannot expose. Neither is a superset of the other, and a fuzzy
    merge would only invent disagreements.
    """
    elements = read_controls(hwnd)
    image, lines = read_text(hwnd, region, wait_seconds)
    readable = [item["name"] for item in elements if item["name"]]
    return {
        "window": window_info(hwnd),
        "region": region,
        "width": image.width,
        "height": image.height,
        "elements": elements,
        "lines": lines,
        "text": "\n".join(readable + [item["text"] for item in lines]),
    }


def find(hwnd, query, region=None, wait_seconds=0):
    """Locate something on screen and return where to act on it.

    Control names are searched first: a match there is an actionable element
    with an exact rectangle, which beats a text box the OCR happened to
    recognize."""
    query = (query or "").strip()
    if not query:
        raise RuntimeError("请提供要查找的文字")
    seen = see(hwnd, region, wait_seconds)
    needle = query.casefold()
    controls = [item for item in seen["elements"] if needle in item["name"].casefold()]
    lines = [item for item in seen["lines"] if needle in item["text"].casefold()]
    return {
        "query": query,
        "window": seen["window"],
        "elements": controls,
        "lines": lines,
        "best": controls[0] if controls else (lines[0] if lines else None),
    }


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
    # Self-render ignores Z-order but still refuses a window that is gone.
    covered = {**ok, "foreground": False, "blockers": ["微信"]}
    assert evaluate_capture_state(covered, require_front=False) is None
    for patch, expected in [({"exists": False}, "已关闭"), ({"minimized": True}, "已最小化")]:
        reason = evaluate_capture_state({**covered, **patch}, require_front=False)
        assert reason and expected in reason, (patch, reason)
    print("PASS: foreground window is capturable")
    print("PASS: closed / cloaked / hidden / minimized / background / occluded are all refused")
    print("PASS: a covered window is still readable when it renders itself")
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
        detail = str(error)
        if os.environ.get("CC_HAHA_VISUAL_GUARD_DEBUG"):
            detail += "\n" + traceback.format_exc()
        send({"id": request.get("id") if request else None, "ok": False, "error": detail})
