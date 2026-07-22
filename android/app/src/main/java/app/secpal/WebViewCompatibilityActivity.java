/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.os.Bundle;
import android.view.WindowManager;

import androidx.appcompat.app.AppCompatActivity;

public class WebViewCompatibilityActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!BuildConfig.ALLOW_SCREENSHOTS) {
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE
            );
        }
        setContentView(R.layout.activity_webview_compatibility);
    }

    @Override
    protected void onResume() {
        super.onResume();
        enforceManagedPolicy();
    }

    void enforceManagedPolicy() {
        EnterprisePolicyController.maybeEnterLockTask(this);
    }
}
