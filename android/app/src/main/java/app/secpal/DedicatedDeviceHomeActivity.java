/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.view.View;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.AppCompatImageView;
import androidx.appcompat.widget.AppCompatTextView;

import java.util.ArrayList;
import java.util.List;

public final class DedicatedDeviceHomeActivity extends AppCompatActivity {
    private GridLayout appGrid;
    private TextView emptyState;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_dedicated_device_home);

        appGrid = findViewById(R.id.enterprise_home_app_grid);
        emptyState = findViewById(R.id.enterprise_home_empty_state);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();

        EnterpriseManagedState managedState = EnterprisePolicyController.syncPolicy(this);

        EnterprisePolicyController.maybeEnterLockTask(this);

        if (!managedState.isKioskActive()) {
            openSecPal();
            finish();
            return;
        }

        renderLauncher(managedState);
    }

    private void renderLauncher(EnterpriseManagedState managedState) {
        appGrid.removeAllViews();

        List<LauncherTile> tiles = new ArrayList<>();

        tiles.add(new LauncherTile(
            getString(R.string.enterprise_home_open_secpal),
            resolveAppIcon(getPackageName()),
            view -> openSecPal()
        ));

        for (EnterprisePolicyController.AllowedLaunchApp allowedApp
            : EnterprisePolicyController.resolveAllowedLaunchApps(this)) {
            tiles.add(new LauncherTile(
                allowedApp.getLabel(),
                resolveAppIcon(allowedApp.getPackageName()),
                view -> EnterprisePolicyController.launchAllowedApp(
                    this,
                    allowedApp.getPackageName()
                )
            ));
        }

        String dialerPackage = managedState.resolveDialerPackage(this);

        if (managedState.isAllowPhone() && dialerPackage != null) {
            tiles.add(new LauncherTile(
                getString(R.string.enterprise_home_phone_label),
                resolveAppIcon(dialerPackage, android.R.drawable.sym_action_call),
                view -> EnterprisePolicyController.launchPhone(this)
            ));
        }

        String smsPackage = managedState.resolveSmsPackage(this);

        if (managedState.isAllowSms() && smsPackage != null) {
            tiles.add(new LauncherTile(
                getString(R.string.enterprise_home_sms_label),
                resolveAppIcon(smsPackage, android.R.drawable.sym_action_email),
                view -> EnterprisePolicyController.launchSms(this)
            ));
        }

        for (LauncherTile tile : tiles) {
            addLauncherTile(tile);
        }

        emptyState.setVisibility(tiles.size() <= 1 ? View.VISIBLE : View.GONE);
    }

    private void addLauncherTile(LauncherTile tile) {
        LinearLayout tileView = new LinearLayout(this);
        GridLayout.LayoutParams layoutParams = new GridLayout.LayoutParams();

        layoutParams.width = 0;
        layoutParams.height = GridLayout.LayoutParams.WRAP_CONTENT;
        layoutParams.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
        layoutParams.setMargins(toPixels(8), toPixels(8), toPixels(8), toPixels(8));

        tileView.setLayoutParams(layoutParams);
        tileView.setOrientation(LinearLayout.VERTICAL);
        tileView.setGravity(android.view.Gravity.CENTER_HORIZONTAL);
        tileView.setBackgroundResource(R.drawable.enterprise_home_tile_background);
        tileView.setClickable(true);
        tileView.setFocusable(true);
        tileView.setMinimumHeight(toPixels(132));
        tileView.setPadding(toPixels(14), toPixels(18), toPixels(14), toPixels(14));
        tileView.setOnClickListener(tile.getClickListener());

        ImageView iconView = new AppCompatImageView(this);
        LinearLayout.LayoutParams iconLayoutParams = new LinearLayout.LayoutParams(
            toPixels(56),
            toPixels(56)
        );

        iconView.setLayoutParams(iconLayoutParams);
        iconView.setImageDrawable(tile.getIcon());
        iconView.setScaleType(ImageView.ScaleType.FIT_CENTER);

        TextView labelView = new AppCompatTextView(this);
        LinearLayout.LayoutParams labelLayoutParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );

        labelLayoutParams.topMargin = toPixels(12);
        labelView.setLayoutParams(labelLayoutParams);
        labelView.setGravity(android.view.Gravity.CENTER);
        labelView.setMaxLines(2);
        labelView.setText(tile.getLabel());
        labelView.setTextAppearance(this, android.R.style.TextAppearance_Medium);
        labelView.setTextColor(getColor(android.R.color.white));

        tileView.addView(iconView);
        tileView.addView(labelView);
        appGrid.addView(tileView);
    }

    private void openSecPal() {
        Intent intent = new Intent(this, MainActivity.class);

        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
    }

    private int toPixels(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
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

    private static final class LauncherTile {
        private final String label;
        private final Drawable icon;
        private final View.OnClickListener clickListener;

        LauncherTile(String label, Drawable icon, View.OnClickListener clickListener) {
            this.label = label;
            this.icon = icon;
            this.clickListener = clickListener;
        }

        String getLabel() {
            return label;
        }

        Drawable getIcon() {
            return icon;
        }

        View.OnClickListener getClickListener() {
            return clickListener;
        }
    }
}
