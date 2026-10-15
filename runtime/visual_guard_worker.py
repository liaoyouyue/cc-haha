import hashlib
import json
import queue
import sys
import threading
import time

import numpy as np
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

write_lock = threading.Lock()
watch_stop = threading.Event()
watch_pause = threading.Event()
watch_thread = None
ocr_engine = None
seen = set()


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


def capture(hwnd, region=None):
    if not win32gui.IsWindow(hwnd):
        raise RuntimeError("目标窗口已关闭")
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width, height = right - left, bottom - top
    if region:
        x, y, width, height = map(int, region)
        left += x
        top += y
    if width <= 0 or height <= 0:
        raise RuntimeError("截图区域无效")
    with mss() as grabber:
        shot = grabber.grab({"left": left, "top": top, "width": width, "height": height})
    return Image.frombytes("RGB", shot.size, shot.rgb)


def recognize(hwnd, region=None):
    global ocr_engine
    if ocr_engine is None:
        ocr_engine = RapidOCR()
    image = capture(hwnd, region)
    result, _ = ocr_engine(np.asarray(image))
    messages = []
    for box, text, score in result or []:
        text = text.strip()
        if score < 0.45 or not text:
            continue
        center_x = sum(point[0] for point in box) / len(box) / image.width
        messages.append({
            "role": "self" if center_x > 0.58 else "customer",
            "text": text,
            "score": round(float(score), 3),
            "top": min(point[1] for point in box),
        })
    messages.sort(key=lambda item: item.pop("top"))
    transcript = "\n".join(
        f"{'我' if item['role'] == 'self' else '客户'}：{item['text']}" for item in messages
    )
    digest = hashlib.sha256(" ".join(transcript.split()).lower().encode("utf-8")).hexdigest()
    return {"messages": messages, "transcript": transcript, "digest": digest}


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


def watch(hwnd, region, interval):
    while not watch_stop.wait(0.1):
        if watch_pause.is_set():
            continue
        try:
            result = recognize(hwnd, region)
            if result["transcript"] and result["digest"] not in seen:
                seen.add(result["digest"])
                send({"event": "ocr", "payload": result})
            elif result["transcript"]:
                send({"event": "duplicate", "payload": {"digest": result["digest"]}})
        except Exception as error:
            send({"event": "error", "payload": {"message": str(error)}})
            return
        watch_stop.wait(max(1.0, float(interval)))
    send({"event": "stopped", "payload": {}})


def handle(command):
    global watch_thread
    action = command.get("action")
    args = command.get("args") or {}
    if action == "ping":
        return {"ready": True}
    if action == "windows":
        return list_windows()
    if action == "recognize":
        return recognize(int(args["hwnd"]), args.get("region"))
    if action == "select_region":
        return {"region": select_region(int(args["hwnd"]))}
    if action == "start":
        if watch_thread and watch_thread.is_alive():
            raise RuntimeError("值守任务已在运行")
        seen.clear()
        watch_stop.clear()
        watch_pause.clear()
        watch_thread = threading.Thread(
            target=watch,
            args=(int(args["hwnd"]), args.get("region"), args.get("interval", 3)),
            daemon=True,
        )
        watch_thread.start()
        return {"state": "running"}
    if action == "pause":
        watch_pause.set()
        return {"state": "paused"}
    if action == "resume":
        watch_pause.clear()
        return {"state": "running"}
    if action == "stop":
        watch_stop.set()
        if watch_thread:
            watch_thread.join(timeout=3)
        return {"state": "stopped"}
    if action == "shutdown":
        watch_stop.set()
        return {"state": "shutdown"}
    raise RuntimeError(f"未知操作：{action}")


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
