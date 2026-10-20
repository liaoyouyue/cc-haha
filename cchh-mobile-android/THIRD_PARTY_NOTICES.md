# CCHH Mobile Android · Third Party Notices

This document lists third-party software included in CCHH Mobile Android v0.1.5, their licenses, and attribution requirements per upstream license terms.

---

## Core Framework

### Expo (expo@~57.0.17)
- **License**: MIT License
- **Source**: https://github.com/expo/expo
- **Copyright**: (c) 2024 Expo team and contributors

### React Native (react-native@0.86.3)
- **License**: MIT License
- **Source**: https://github.com/facebook/react-native
- **Copyright**: (c) Meta Platforms, Inc. and contributors

### React (react@19.2.3)
- **License**: MIT License
- **Source**: https://github.com/facebook/react
- **Copyright**: (c) Meta Platforms, Inc. and contributors

---

## Expo Modules

### expo-secure-store (~57.0.0)
- **License**: MIT License
- **Source**: https://github.com/expo/expo/tree/main/packages/expo-secure-store
- **Copyright**: (c) 2024 Expo team and contributors

### expo-status-bar (~57.0.1)
- **License**: MIT License
- **Source**: https://github.com/expo/expo/tree/main/packages/expo-status-bar

### expo-build-properties (~57.0.22)
- **License**: MIT License
- **Source**: https://github.com/expo/expo/tree/main/packages/expo-build-properties

### expo-camera (~57.0.6)
- **License**: MIT License
- **Source**: https://github.com/expo/expo/tree/main/packages/expo-camera
- **Copyright**: (c) 2024 Expo team and contributors

### react-native-safe-area-context (~5.7.0)
- **License**: MIT License
- **Source**: https://github.com/th3rdwave/react-native-safe-area-context
- **Copyright**: (c) 2020 Emil Sjölander and contributors

---

## Network & Cookie Management

### @preeternal/react-native-cookie-manager (7.0.0)
- **License**: MIT License
- **Source**: https://github.com/preeternal/react-native-cookie-manager
- **Copyright**: (c) 2023 Preeternal

---

## Transitive Dependencies (Major)

### AndroidX Libraries
- **License**: Apache License 2.0
- **Source**: https://android.googlesource.com/platform/frameworks/support/
- **Copyright**: (c) The Android Open Source Project

Includes: androidx.activity, androidx.annotation, androidx.appcompat, androidx.arch.core, androidx.biometric, androidx.camera, androidx.cardview, androidx.collection, androidx.compose, androidx.core, androidx.fragment, androidx.lifecycle, androidx.navigation, androidx.recyclerview, androidx.room, androidx.security, androidx.vectordrawable, etc.

### Kotlin Standard Library
- **License**: Apache License 2.0
- **Source**: https://github.com/JetBrains/kotlin
- **Copyright**: (c) 2010-2024 JetBrains s.r.o. and contributors

### Kotlinx Coroutines
- **License**: Apache License 2.0
- **Source**: https://github.com/Kotlin/kotlinx.coroutines
- **Copyright**: (c) 2015-2024 JetBrains s.r.o. and contributors

### OkHttp / Okio
- **License**: Apache License 2.0
- **Source**: https://square.github.io/okhttp/
- **Copyright**: (c) 2013-2024 Square, Inc.

### Guava (ListenableFuture)
- **License**: Apache License 2.0
- **Source**: https://github.com/google/guava
- **Copyright**: (c) The Guava Authors

### JSI / Hermes
- **License**: MIT License
- **Source**: https://github.com/facebook/hermes
- **Copyright**: (c) Meta Platforms, Inc. and contributors

### fbjni
- **License**: MIT License
- **Source**: https://github.com/facebook/fbjni
- **Copyright**: (c) Meta Platforms, Inc. and contributors

### Image Processing Libraries
- **gifimage**: MIT License
- **libstatic-webp**: BSD 3-Clause License
- **libimagepipeline**: BSD 3-Clause License
- **libnative-imagetranscoder**: Apache License 2.0

### zstd (libzstd-kmp)
- **License**: BSD 3-Clause License
- **Source**: https://github.com/facebook/zstd
- **Copyright**: (c) 2016-2024 Facebook, Inc.

---

## Upstream Licenses

### cc-haha v0.7.4
- **License**: cc-haha Community Source License 1.0 (Custom, non-OSI)
- **Source**: https://github.com/NanmiCoder/cc-haha/blob/v0.7.4/LICENSE
- **Copyright**: (c) 2026 cc-haha
- **Note**: Non-commercial community sharing permitted with attribution. Commercial use requires separate authorization.

---

## CCHH Mobile Android (This Project)

### Project Code
- **License**: Same as upstream (cc-haha Community Source License 1.0)
- **Copyright**: (c) 2026 cc-haha
- **Source**: https://github.com/liaoyouyue/cc-haha (feat/cchh-mobile-community-pairing-20261019)

---

## License Compliance Summary

| Requirement | Status | Notes |
|-------------|--------|-------|
| MIT/Apache licenses included | ✅ | All MIT/Apache dependencies have license files in APK META-INF |
| Upstream cc-haha license | ✅ | Community Source License 1.0 included |
| Non-commercial restriction noted | ✅ | Documented in COMMUNITY_BETA.md and LICENSE |
| Attribution in APK | ✅ | META-INF/NOTICE.md and individual LICENSE.txt files present |
| No GPL/LGPL dependencies | ✅ | Verified - all transitive deps are MIT/Apache/BSD |

---

## Distribution Notes

1. **APK includes**: META-INF/NOTICE.md and individual LICENSE.txt files for all third-party components
2. **Source availability**: This project's source is available at the repository URL above
3. **Upstream source**: https://github.com/NanmiCoder/cc-haha (v0.7.4 tag)
3. **No GPL/LGPL**: Confirmed - no copyleft dependencies in the dependency chain
4. **Attribution**: All licenses require preserving copyright notices and license terms in redistributions

---

*Generated: 2026-10-20 | CCHH Mobile Android v0.1.5 | Based on cc-haha v0.7.4*