/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.GridLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;

public final class DedicatedDeviceHomeActivity extends AppCompatActivity {
    private static final String LOG_TAG = "SecPalDedicatedHome";
    private static volatile DedicatedDeviceHomeDependencies dependencies = new DedicatedDeviceHomeDependencies();

    private GridLayout appGrid;
    private TextView emptyState;
    private DedicatedDeviceHomeTileGridRenderer tileGridRenderer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        if (!LegacyEnrollmentBootstrapCleanup.clear(this)) {
            Log.w(LOG_TAG, "Failed to clear retired enrollment bootstrap state; cleanup will retry");
        }
        super.onCreate(savedInstanceState);
        if (!BuildConfig.ALLOW_SCREENSHOTS) {
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE
            );
        }
        setContentView(R.layout.activity_dedicated_device_home);

        appGrid = findViewById(R.id.enterprise_home_app_grid);
        emptyState = findViewById(R.id.enterprise_home_empty_state);
        tileGridRenderer = createTileGridRenderer();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();

        EnterpriseManagedState managedState = dependencies.syncPolicy(this);
        dependencies.maybeEnterLockTask(this);

        if (!managedState.isKioskActive()) {
            openSecPal();
            finish();
            return;
        }

        renderLauncher(managedState);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event != null && EnterpriseHardwareButtonLaunch.isSupportedLaunchKeyCode(event.getKeyCode())) {
            String hardwareAction = EnterpriseHardwareButtonLaunch.resolveLaunchAction(event);

            if (hardwareAction != null) {
                startActivity(
                    EnterpriseHardwareButtonLaunch.createForegroundLaunchIntent(
                        this,
                        hardwareAction,
                        event.getKeyCode()
                    )
                );
            }

            return true;
        }

        return super.dispatchKeyEvent(event);
    }

    private void renderLauncher(EnterpriseManagedState managedState) {
        List<DedicatedDeviceHomeTileModel> tiles = new ArrayList<>();

        tiles.add(new DedicatedDeviceHomeTileModel(
            getString(R.string.enterprise_home_open_secpal),
            resolveAppIcon(getPackageName()),
            view -> openSecPal()
        ));

        for (EnterprisePolicyController.AllowedLaunchApp allowedApp
            : dependencies.resolveAllowedLaunchApps(this)) {
            tiles.add(new DedicatedDeviceHomeTileModel(
                allowedApp.getLabel(),
                resolveAppIcon(allowedApp.getPackageName()),
                view -> dependencies.launchAllowedApp(
                    this,
                    allowedApp.getPackageName()
                )
            ));
        }

        String dialerPackage = dependencies.resolveDialerPackage(managedState, this);

        if (managedState.isAllowPhone() && dialerPackage != null) {
            tiles.add(new DedicatedDeviceHomeTileModel(
                getString(R.string.enterprise_home_phone_label),
                resolveAppIcon(dialerPackage, android.R.drawable.sym_action_call),
                view -> dependencies.launchPhone(this)
            ));
        }

        String smsPackage = dependencies.resolveSmsPackage(managedState, this);

        if (managedState.isAllowSms() && smsPackage != null) {
            tiles.add(new DedicatedDeviceHomeTileModel(
                getString(R.string.enterprise_home_sms_label),
                resolveAppIcon(smsPackage, android.R.drawable.sym_action_email),
                view -> dependencies.launchSms(this)
            ));
        }

        tileGridRenderer.render(appGrid, tiles);

        emptyState.setVisibility(tiles.size() <= 1 ? View.VISIBLE : View.GONE);
    }

    private void openSecPal() {
        Intent intent = new Intent(this, MainActivity.class);

        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
    }

    private DedicatedDeviceHomeTileGridRenderer createTileGridRenderer() {
        return new DedicatedDeviceHomeTileGridRenderer(LayoutInflater.from(this));
    }

    private Drawable resolveAppIcon(String packageName) {
        return resolveAppIcon(packageName, android.R.drawable.sym_def_app_icon);
    }

    private Drawable resolveAppIcon(String packageName, int fallbackIconRes) {
        PackageManager packageManager = getPackageManager();

        if (packageName != null && !packageName.trim().isEmpty()) {
            try {
                ApplicationInfo applicationInfo = packageManager.getApplicationInfo(packageName, 0);

                return packageManager.getApplicationIcon(applicationInfo);
            } catch (PackageManager.NameNotFoundException ignored) {
            }
        }

        return getDrawable(fallbackIconRes);
    }

    static void setDependenciesForTest(DedicatedDeviceHomeDependencies testDependencies) {
        dependencies = testDependencies;
    }

    static void resetDependencies() {
        dependencies = new DedicatedDeviceHomeDependencies();
    }
}
