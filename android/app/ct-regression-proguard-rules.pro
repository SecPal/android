# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later

# The app and instrumentation APK are minified separately. Keep this shared
# runtime boundary stable so the test APK can call into the packaged app.
-keep class kotlin.LazyKt** { *; }
-keep class kotlin.ResultKt { *; }
-keep class kotlin.collections.AbstractIterator { *; }
-keep class kotlin.coroutines.ContinuationKt { *; }
-keep class kotlin.coroutines.intrinsics.IntrinsicsKt** { *; }
-keep class kotlin.coroutines.jvm.internal.DebugProbesKt { *; }
-keep class kotlin.io.CloseableKt { *; }
-keep class kotlin.jvm.internal.Intrinsics { *; }
-keep class kotlin.jvm.internal.StringCompanionObject { *; }
-keep class kotlin.time.DurationKt { *; }

# AndroidJUnitRunner uses Trace from the shared test process, while Android
# packaging can place the dependency only in the separately minified app APK.
-keep class androidx.tracing.Trace { *; }

# Management consumer instrumentation crosses the minified Work/test APK boundary.
-keep class app.secpal.EnterprisePolicyClient { *; }
-keep class app.secpal.EnterpriseManagedState { *; }

# Certificate assertions call the packaged shared identity boundary.
-keep class app.secpal.ManagementPackageIdentity { *; }
