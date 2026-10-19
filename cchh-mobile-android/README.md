# CCHH Mobile Android · Unofficial 0.1.4 Test

Based on cc-haha: https://github.com/NanmiCoder/cc-haha
Copyright (c) 2026 cc-haha

Standalone Android React Native client for CCHH v0.7.4 (H5/LAN token mode). This is not the official app, nor a WebView shell.

Built in an isolated branch. Does not deploy or alter CCHH server, production data, or API keys. Phone connects through a private-network URL with a user-supplied H5 token saved in SecureStore.

Supports: experimental native ngrok pairing, existing sessions, basic text conversation, live assistant streaming, stop, single-use permission approvals, reconnect, transcript refresh, no automatic replay on connection loss. Some advanced CCHH features are not implemented. Ngrok public Cookie pairing is implemented via native fetch with credentials and Origin plus desktop approval. The mobile flow has no WebView. Android real-device acceptance testing is still pending. Do not expose a raw CCHH port on the public internet.

This Android build uses test signing. Do not upload credentials or use it for sensitive production operations before Android-device acceptance tests.

CCHH upstream source license (v0.7.4): https://github.com/NanmiCoder/cc-haha/blob/v0.7.4/LICENSE . For redistribution ensure all required license and attribution notices are included. App is for personal noncommercial testing; consult the full upstream license before commercial use.
