import ctypes
import hashlib
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

try:  # Windows' own OCR engine, reached through WinRT
    import winsdk.windows.graphics.imaging as _win_imaging
    import winsdk.windows.storage.streams as _win_streams

    class _WinSdk:
        InMemoryRandomAccessStream = _win_streams.InMemoryRandomAccessStream
        DataWriter = _win_streams.DataWriter
        BitmapDecoder = _win_imaging.BitmapDecoder

    winsdk = _WinSdk()
except Exception:
    winsdk = None

_win_engine = None

# A frozen (PyInstaller) build inherits the OEM code page for stdio even when
# PYTHONUTF8/PYTHONIOENCODING are set, which mangles Chinese window titles on
# the wire. Pin both streams to UTF-8 instead of trusting the environment.
# A --windowed build reports None for a stream it has no console for, which is
# why this is guarded rather than unconditional.
for _stream in (sys.stdin, sys.stdout):
    if _stream is not None and hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

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
# Last marked read per (window, region), so a caller can ask whether the
# interface reacted instead of diffing two full dumps itself.
snapshots = {}
# Last OCR result per (window, region), keyed by a hash of the captured frame.
ocr_cache = {}


def encode_png(image):
    import base64
    import io

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


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


def control_state(control):
    """读 UIA 的 enabled / offscreen / value，失败时安全回退，不打断整棵树遍历。"""
    state = {}
    try:
        state["enabled"] = bool(control.IsEnabled)
    except Exception:
        state["enabled"] = True
    try:
        state["offscreen"] = bool(control.IsOffscreen)
    except Exception:
        state["offscreen"] = False
    try:
        pattern = control.GetValuePattern()
    except Exception:
        pattern = None
    if pattern is not None:
        try:
            value = (pattern.Value or "").strip()
        except Exception:
            value = ""
        if value:
            state["value"] = value[:200]
    return state


def read_controls(hwnd, budget=400):
    """The window's control tree: role, accessible name, screen rectangle, plus
    enabled / offscreen / value so a caller can tell a disabled button from an
    active one without guessing from pixels.

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
                        **control_state(child),
                    })
            walk(child, depth + 1)

    try:
        walk(uiautomation.ControlFromHandle(hwnd), 1)
    except Exception:
        return []
    rows.sort(key=lambda item: (item["box"][1], item["box"][0]))
    return rows


def join_words(words):
    """Windows OCR returns one word per CJK character and joins them with
    spaces, so '报价' arrives as '报 价' and a substring search would miss it."""
    text = ""
    for word in words:
        if text and not (text[-1].isascii() and word[:1].isascii()):
            text += word          # CJK run: no separator
        elif text:
            text += " " + word    # latin run: keep word boundaries
        else:
            text = word
    return text.strip()


def win_ocr_engine():
    """The engine built into Windows, created once per process."""
    global _win_engine
    if _win_engine is False:
        return None
    if _win_engine is None:
        try:
            from winsdk.windows.globalization import Language
            from winsdk.windows.media.ocr import OcrEngine

            _win_engine = (
                OcrEngine.try_create_from_language(Language("zh-Hans-CN"))
                or OcrEngine.try_create_from_user_profile_languages()
                or False
            )
        except Exception:
            _win_engine = False
    return _win_engine or None


def ocr_fast(image):
    """Windows OCR: ~0.15 s and no model to load, but it reads Chinese slightly
    worse than RapidOCR (询问 → 词问). That trade is why the caller gets a
    choice; None here means "fall back"."""
    engine = win_ocr_engine()
    if engine is None or winsdk is None:
        return None
    try:
        import asyncio
        import io

        async def run():
            stream = winsdk.InMemoryRandomAccessStream()
            writer = winsdk.DataWriter(stream)
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            writer.write_bytes(buffer.getvalue())
            await writer.store_async()
            await writer.flush_async()
            stream.seek(0)
            decoder = await winsdk.BitmapDecoder.create_async(stream)
            bitmap = await decoder.get_software_bitmap_async()
            return await engine.recognize_async(bitmap)

        result = asyncio.new_event_loop().run_until_complete(run())
    except Exception:
        return None
    if result is None:
        return None
    rows = []
    for line in result.lines:
        words = list(line.words)
        if not words:
            continue
        left = int(min(w.bounding_rect.x for w in words))
        top = int(min(w.bounding_rect.y for w in words))
        right = int(max(w.bounding_rect.x + w.bounding_rect.width for w in words))
        bottom = int(max(w.bounding_rect.y + w.bounding_rect.height for w in words))
        rows.append(([left, top, right - left, bottom - top], join_words([w.text for w in words]), 0.9))
    return rows or None


def read_text(hwnd, region, wait_seconds, accurate=False):
    """OCR pass: positioned text for apps that expose no control tree, and for
    text drawn inside a single control the tree cannot break apart.

    Default is the fast system engine; accurate=True pays ~3 s for RapidOCR,
    which reads Chinese more reliably."""
    global ocr_engine
    origin_left, origin_top, _, _ = capture_rect(hwnd, region)
    image = capture_when_ready(hwnd, region, wait_seconds)
    # OCR is the expensive half; a window that has not repainted cannot have
    # new text. Comparing the frame first makes repeat reads nearly free.
    digest = hashlib.sha1(image.tobytes()).hexdigest()
    cache_key = (hwnd, tuple(region) if region else None, accurate)
    cached = ocr_cache.get(cache_key)
    if cached and cached[0] == digest:
        return image, [dict(line) for line in cached[1]]

    rows = None
    if not accurate:
        rows = ocr_fast(image)
    if rows is None:
        if ocr_engine is None:
            ocr_engine = RapidOCR()
        result, _ = ocr_engine(np.asarray(image))
        rows = []
        for box, text, score in result or []:
            text = text.strip()
            if score >= 0.45 and text:
                xs = [point[0] for point in box]
                ys = [point[1] for point in box]
                rows.append(([min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)], text, float(score)))

    lines = []
    for box, text, score in rows:
        bx, by, bw, bh = (int(v) for v in box)
        lines.append({
            "text": text,
            "score": round(float(score), 3),
            "box": [origin_left + bx, origin_top + by, bw, bh],
            "center": [origin_left + bx + bw // 2, origin_top + by + bh // 2],
            "source": "ocr",
            "_top": by,
        })
    lines.sort(key=lambda item: (item["_top"], item["box"][0]))
    for item in lines:
        item.pop("_top")
    ocr_cache[cache_key] = (digest, [dict(line) for line in lines])
    return image, lines


def item_key(item):
    """Identity of a read item across reads: what it is, where, what it says."""
    label = item.get("name") if item.get("source") == "uia" else item.get("text")
    return (item["source"], item.get("role", ""), label or "", tuple(item["box"]))


def annotate(image, items):
    """Draw numbered boxes so a vision model can pick a target by number
    instead of estimating pixels. Only the drawing is local; no model runs."""
    from PIL import ImageDraw

    marked = image.copy()
    draw = ImageDraw.Draw(marked)
    for item in items:
        left, top, width, height = item["box"]
        draw.rectangle([left, top, left + width, top + height], outline=(220, 38, 38), width=2)
        draw.text((left + 3, max(0, top + 2)), str(item["index"]), fill=(220, 38, 38))
    return marked


def see(hwnd, region=None, wait_seconds=0, mark=False, accurate=False):
    """Read the window as positioned text, in screen coordinates.

    Two independent reads, returned side by side rather than merged: the
    control tree names things and says what is actionable, OCR catches text
    the tree cannot expose. Neither is a superset of the other, and a fuzzy
    merge would only invent disagreements.

    mark=True also renders the window with every item numbered, so a caller
    that can look at a picture can name a target instead of doing arithmetic.
    """
    elements = read_controls(hwnd)
    image, lines = read_text(hwnd, region, wait_seconds, accurate)
    readable = [item["name"] for item in elements if item["name"]]
    result = {
        "window": window_info(hwnd),
        "region": region,
        "width": image.width,
        "height": image.height,
        "elements": elements,
        "lines": lines,
        "text": "\n".join(readable + [item["text"] for item in lines]),
    }
    if mark:
        items = elements + lines
        for index, item in enumerate(items):
            item["index"] = index
        key = (hwnd, tuple(region) if region else None)
        previous = snapshots.get(key)
        current = {item_key(item) for item in items}
        result["items"] = items
        result["changed"] = previous is None or current != previous
        result["image_png_base64"] = encode_png(annotate(image, items))
        snapshots[key] = current
    return result


def find(hwnd, query, region=None, wait_seconds=0, accurate=False):
    """Locate something on screen and return where to act on it.

    Control names are searched first, and when one matches the OCR pass is
    skipped entirely: the control tree already gave an exact rectangle, and
    OCR is the expensive half. Text that no control carries still needs it.
    """
    query = (query or "").strip()
    if not query:
        raise RuntimeError("请提供要查找的文字")
    needle = query.casefold()
    controls = read_controls(hwnd)
    matched = [item for item in controls if needle in item["name"].casefold()]
    if matched:
        return {
            "query": query,
            "window": window_info(hwnd),
            "elements": matched,
            "lines": [],
            "best": matched[0],
            "skipped_ocr": True,
        }
    _, lines = read_text(hwnd, region, wait_seconds, accurate)
    text_hits = [line for line in lines if needle in squash(line["text"])]
    return {
        "query": query,
        "window": window_info(hwnd),
        "elements": [],
        "lines": text_hits,
        "best": text_hits[0] if text_hits else None,
        "skipped_ocr": False,
    }


def squash(text):
    """Compare text ignoring spaces: the fast engine separates every CJK
    character, so '报价' arrives as '报 价' and would never match otherwise."""
    return text.replace(" ", "").casefold()


def wait_for_text(hwnd, region, until_text, timeout_seconds, poll_seconds):
    """轮询 see()，直到 until_text 出现在窗口文字里（子串匹配，不区分大小写）
    或达到硬上限。返回 matched / waited_ms / text，不会让调用方无限等待。"""
    needle = squash(until_text or "")
    deadline = time.monotonic() + max(0.0, float(timeout_seconds))
    start = time.monotonic()
    while True:
        result = see(hwnd, region, 0, False)
        text = result.get("text", "")
        waited = int((time.monotonic() - start) * 1000)
        if needle and needle in squash(text):
            return {"matched": True, "waited_ms": waited, "text": text}
        if time.monotonic() >= deadline:
            return {"matched": False, "waited_ms": waited, "text": text}
        if watch_stop.wait(float(poll_seconds)):
            raise CaptureBlocked("已取消等待。")


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
        return see(
            int(args["hwnd"]), args.get("region"), wait,
            bool(args.get("mark")), bool(args.get("accurate")),
        )
    if action == "find":
        return find(
            int(args["hwnd"]), args.get("query"), args.get("region"), wait,
            bool(args.get("accurate")),
        )
    if action == "select_region":
        return {"region": select_region(int(args["hwnd"]))}
    if action == "wait":
        timeout = min(60.0, max(0.0, float(args.get("timeout_seconds") or 10)))
        poll = min(5.0, max(0.1, float(args.get("poll_seconds") or 0.5)))
        return wait_for_text(
            int(args["hwnd"]), args.get("region"), args.get("until_text") or "",
            timeout, poll,
        )
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

    # Element state fields: shape only, no live UIA needed.
    sample = control_state(type("C", (), {"IsEnabled": True, "IsOffscreen": False,
                                          "GetValuePattern": lambda self: None})())
    assert set(sample) == {"enabled", "offscreen"}, sample
    assert sample["enabled"] is True and sample["offscreen"] is False
    sample = control_state(type("C", (), {"IsEnabled": False, "IsOffscreen": True,
                                          "GetValuePattern": lambda self: None})())
    assert sample["enabled"] is False and sample["offscreen"] is True
    print("PASS: control_state emits enabled/offscreen, omits value when absent")
    # 只读：不提供任何点击/输入动作
    assert "click_at" not in globals() and "scroll_at" not in globals()
    print("PASS: read-only — no click or scroll action exists")
    return 0


def main():
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


# Importing this module must not start the worker loop: the MCP server imports
# it to reuse the reads and speaks a different protocol on the same streams.
if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(selftest())
    main()
