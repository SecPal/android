# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

# The app and instrumentation APK are minified separately. Keep this shared
# runtime boundary stable so the test APK can call into the packaged app.
-keep class kotlin.jvm.internal.Intrinsics { *; }
