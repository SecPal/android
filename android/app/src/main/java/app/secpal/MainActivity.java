/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.KeyguardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Build;
import android.util.Log;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String LOG_TAG = "SecPalMainActivity";
    private static final String RUNTIME_PREFS = "secpal_native_runtime";
    private static final String LAST_UPDATE_TIME_KEY = "last_update_time";
    private static final String[] LEGACY_PWA_STATE_PATHS = new String[] {
        "app_webview/Default/Service Worker",
        "app_webview/Service Worker",
        "app_webview/Default/CacheStorage",
        "app_webview/Default/Code Cache",
        "app_webview/Code Cache"
    };
    private final ExecutorService provisioningBootstrapExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean provisioningBootstrapSyncInFlight = new AtomicBoolean(false);
    private final OnBackPressedCallback webViewBackPressedCallback = new OnBackPressedCallback(true) {
        @Override
        public void handleOnBackPressed() {
            if (WebViewBackNavigationController.goBackIfPossible(resolveBackNavigationTarget())) {
                return;
            }

            setEnabled(false);

            try {
                getOnBackPressedDispatcher().onBackPressed();
            } finally {
                setEnabled(true);
            }
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecPalNativeAuthPlugin.class);
        registerPlugin(SecPalEnterprisePlugin.class);
        purgeLegacyPwaStateIfAppUpdated();
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, webViewBackPressedCallback);
        handleSamsungHardwareButtonLaunch(getIntent());
        scheduleProvisioningBootstrapSync();
        refreshManagedPolicyState();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSamsungHardwareButtonLaunch(intent);
        scheduleProvisioningBootstrapSync();
        refreshManagedPolicyState();
    }

    @Override
    public void onResume() {
        super.onResume();
        scheduleProvisioningBootstrapSync();
        refreshManagedPolicyState();
    }

    @Override
    public void onPause() {
        clearHardwareTriggerWakeState();
        super.onPause();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        SecPalEnterprisePlugin.emitHardwareButtonEvent(event);
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onDestroy() {
        provisioningBootstrapExecutor.shutdownNow();
        super.onDestroy();
    }

    private void purgeLegacyPwaStateIfAppUpdated() {
        long currentUpdateTime = resolveCurrentPackageUpdateTime();

        if (currentUpdateTime <= 0L) {
            return;
        }

        SharedPreferences preferences = getSharedPreferences(RUNTIME_PREFS, MODE_PRIVATE);
        long recordedUpdateTime = preferences.getLong(LAST_UPDATE_TIME_KEY, -1L);

        if (recordedUpdateTime == currentUpdateTime) {
            return;
        }

        purgeLegacyPwaState();
        preferences.edit().putLong(LAST_UPDATE_TIME_KEY, currentUpdateTime).apply();
    }

    private long resolveCurrentPackageUpdateTime() {
        try {
            PackageManager packageManager = getPackageManager();
            PackageInfo packageInfo;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageInfo = packageManager.getPackageInfo(
                    getPackageName(),
                    PackageManager.PackageInfoFlags.of(0)
                );
            } else {
                packageInfo = packageManager.getPackageInfo(getPackageName(), 0);
            }

            return packageInfo.lastUpdateTime;
        } catch (PackageManager.NameNotFoundException exception) {
            Log.w(LOG_TAG, "Failed to resolve package update time", exception);
            return -1L;
        }
    }

    private void purgeLegacyPwaState() {
        // getDataDir() requires API 24; use getApplicationInfo().dataDir (API 1) for minSdkVersion 23 compatibility.
        String dataDirPath = getApplicationInfo().dataDir;

        if (dataDirPath == null || dataDirPath.isEmpty()) {
            Log.w(LOG_TAG, "App data directory unavailable; skipping legacy PWA cleanup");
            return;
        }

        File dataDirectory = new File(dataDirPath);

        for (String relativePath : LEGACY_PWA_STATE_PATHS) {
            File target = new File(dataDirectory, relativePath);

            if (!target.exists()) {
                continue;
            }

            if (!deleteRecursively(target)) {
                Log.w(LOG_TAG, "Failed to fully delete stale WebView path: " + target.getAbsolutePath());
            }
        }
    }

    private void refreshManagedPolicyState() {
        EnterpriseManagedState managedState = EnterprisePolicyController.syncPolicy(this);

        EnterprisePolicyController.maybeEnterLockTask(this);
        SystemNavigationController.maybeCompleteProvisioningGestureNavigation(this, managedState);
    }

    private void handleSamsungHardwareButtonLaunch(Intent intent) {
        String hardwareAction = SamsungHardwareButtonLaunch.resolveLaunchAction(intent, getPackageName());

        if (hardwareAction == null) {
            return;
        }

        requestHardwareTriggerWakeState();
        SecPalEnterprisePlugin.emitSamsungHardwareButtonLaunch(
            hardwareAction,
            SamsungHardwareButtonLaunch.resolveLaunchKeyCode(intent)
        );
        SamsungHardwareButtonLaunch.markHandled(intent);
    }

    private void requestHardwareTriggerWakeState() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);

            KeyguardManager keyguardManager = getSystemService(KeyguardManager.class);

            if (keyguardManager != null) {
                keyguardManager.requestDismissKeyguard(this, null);
            }

            return;
        }

        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );
    }

    private void clearHardwareTriggerWakeState() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(false);
            setTurnScreenOn(false);
            return;
        }

        getWindow().clearFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );
    }

    private void scheduleProvisioningBootstrapSync() {
        if (!provisioningBootstrapSyncInFlight.compareAndSet(false, true)) {
            return;
        }

        provisioningBootstrapExecutor.execute(() -> {
            try {
                ProvisioningBootstrapCoordinator.SyncOutcome outcome =
                    ProvisioningBootstrapCoordinator.fromContext(getApplicationContext()).syncPendingBootstrap();

                if (outcome == ProvisioningBootstrapCoordinator.SyncOutcome.COMPLETED) {
                    runOnUiThread(this::refreshManagedPolicyState);
                }
            } catch (RuntimeException exception) {
                Log.e(LOG_TAG, "Unexpected error during provisioning bootstrap sync", exception);
            } finally {
                provisioningBootstrapSyncInFlight.set(false);
            }
        });
    }

    private WebViewBackNavigationController.BackNavigationTarget resolveBackNavigationTarget() {
        Bridge bridge = getBridge();

        if (bridge == null) {
            return null;
        }

        WebView webView = bridge.getWebView();

        return WebViewBackNavigationController.forWebView(webView);
    }

    private boolean deleteRecursively(File target) {
        File[] children = target.listFiles();
        boolean success = true;

        if (children != null) {
            for (File child : children) {
                success = deleteRecursively(child) && success;
            }
        }

        if (!target.delete() && target.exists()) {
            return false;
        }

        return success;
    }
}
