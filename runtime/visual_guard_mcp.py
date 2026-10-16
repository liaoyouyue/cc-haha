"""真实之眼 as an MCP tool server.

Speaks JSON-RPC over stdio and calls the same worker module the CCHH page uses
(imported from this directory), so both surfaces read windows identically and
neither owns a second copy of the OCR runtime.
"""

import json
import sys

sys.path.insert(0, __file__.rsplit("\\", 1)[0])

try:
    import visual_guard_worker as worker
except ImportError as error:  # rapidocr / uiautomation not installed for this interpreter
    worker = None
    IMPORT_ERROR = (
        f"{error}. 真实之眼 需要这个解释器装有依赖："
        "pip install -r requirements-visual-guard.txt"
    )
else:
    IMPORT_ERROR = None

PROTOCOL_VERSION = "2024-11-05"
MAX_LINES = 300

TOOLS = [
    {
        "name": "eye_windows",
        "description": "列出当前可见的桌面窗口（句柄、标题、进程、位置）。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "eye_see",
        "description": (
            "读取一个窗口，返回带屏幕坐标的文字与控件。窗口被遮挡或在后台也能读；"
            "截图仅在本机做 OCR，不会外传。不指定目标时读当前前台窗口。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "target": {"type": "string", "description": "窗口标题的一部分；省略则用前台窗口"},
                "region": {
                    "type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4,
                    "description": "可选，只读窗口内的这一块 [x, y, 宽, 高]",
                },
                "mark": {
                    "type": "boolean",
                    "description": (
                        "返回一张把每个元素编号画好的窗口图，适合能看图的模型按编号选目标；"
                        "同时给出 changed，表示相比上一次读取界面有没有变化"
                    ),
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "eye_find",
        "description": "在窗口里定位一段文字，返回它的屏幕坐标，可直接用于点击。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "要找的文字"},
                "target": {"type": "string", "description": "窗口标题的一部分；省略则用前台窗口"},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
]


def resolve_target(target):
    """A title fragment, an hwnd, or nothing meaning the foreground window."""
    if target is None or str(target).strip() == "":
        import win32gui

        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            raise RuntimeError("没有前台窗口")
        return hwnd
    text = str(target).strip()
    if text.isdigit():
        return int(text)
    needle = text.casefold()
    for window in worker.list_windows():
        if needle in window["title"].casefold():
            return window["hwnd"]
    raise RuntimeError(f"找不到标题含「{text}」的窗口")


def wrap(label, payload):
    return {"content": [{"type": "text", "text": f"{label}\n{json.dumps(payload, ensure_ascii=False)}"}]}


def call_tool(name, args):
    if worker is None:
        raise RuntimeError(IMPORT_ERROR)
    if name == "eye_windows":
        return wrap("可见窗口：", worker.list_windows())
    if name == "eye_see":
        sight = worker.see(resolve_target(args.get("target")), args.get("region"), 0, bool(args.get("mark")))
        sight["lines"] = sight["lines"][:MAX_LINES]
        png = sight.pop("image_png_base64", None)
        content = wrap("窗口内容与坐标：", sight)["content"]
        if png:
            content.append({"type": "image", "data": png, "mimeType": "image/png"})
        return {"content": content}
    if name == "eye_find":
        found = worker.find(resolve_target(args.get("target")), args.get("query"), None, 0)
        return wrap("定位结果：", found)
    raise RuntimeError(f"未知工具：{name}")


def handle(request):
    method = request.get("method")
    if method == "initialize":
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "real-eye", "version": "1.0.0"},
        }
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        params = request.get("params") or {}
        try:
            return call_tool(params.get("name"), params.get("arguments") or {})
        except Exception as error:
            return {"content": [{"type": "text", "text": f"读取失败：{error}"}], "isError": True}
    if method == "ping":
        return {}
    raise RuntimeError(f"未知方法：{method}")


def main():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        request = None
        try:
            request = json.loads(raw)
            # Notifications carry no id and must not be answered.
            if "id" not in request:
                continue
            result = handle(request)
            reply = {"jsonrpc": "2.0", "id": request["id"], "result": result}
        except Exception as error:
            reply = {"jsonrpc": "2.0", "id": request.get("id") if request else None,
                     "error": {"code": -32603, "message": str(error)}}
        sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
