/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.GridLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.shadows.ShadowActivity;

import java.util.Collections;
import java.util.List;

@RunWith(RobolectricTestRunner.class)
public final class DedicatedDeviceHomeActivityTest {
    @After
    public void tearDown() {
        DedicatedDeviceHomeActivity.resetDependencies();
    }

    @Test
    public void onCreate_clearsRetiredEnrollmentStateForDedicatedHomeLaunch() {
        Context context = RuntimeEnvironment.getApplication();
        SharedPreferences authPreferences = context.getSharedPreferences(
            SecPalNativeAuthPlugin.NATIVE_AUTH_PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
        SharedPreferences enterprisePreferences = context.getSharedPreferences(
            EnterprisePolicyController.ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        );

        authPreferences.edit()
            .putString("bootstrap_token_ciphertext", "encrypted-token")
            .putString("bootstrap_token_iv", "initialization-vector")
            .commit();
        enterprisePreferences.edit()
            .putString("bootstrap_status", "pending")
            .commit();

        try (ActivityController<DedicatedDeviceHomeActivity> controller =
            Robolectric.buildActivity(DedicatedDeviceHomeActivity.class).create()) {
            assertFalse(authPreferences.contains("bootstrap_token_ciphertext"));
            assertFalse(authPreferences.contains("bootstrap_token_iv"));
            assertFalse(enterprisePreferences.contains("bootstrap_status"));
        } finally {
            authPreferences.edit().clear().commit();
            enterprisePreferences.edit().clear().commit();
        }
    }

    @Test
    public void onResume_routesBackToMainWhenKioskHomeInactive() {
        TestDependencies dependencies = new TestDependencies(
            new EnterpriseManagedState(
                EnterpriseManagedState.MODE_NONE,
                EnterprisePolicyConfig.disabled()
            ),
            Collections.emptyList()
        );

        DedicatedDeviceHomeActivity.setDependenciesForTest(dependencies);

        try (ActivityController<DedicatedDeviceHomeActivity> controller =
            Robolectric.buildActivity(DedicatedDeviceHomeActivity.class).setup()) {
            DedicatedDeviceHomeActivity activity = controller.get();
            ShadowActivity shadowActivity = org.robolectric.Shadows.shadowOf(activity);
            Intent nextIntent = shadowActivity.getNextStartedActivity();

            assertTrue(dependencies.maybeEnterLockTaskCalled);
            assertNotNull(nextIntent);
            assertEquals(MainActivity.class.getName(), nextIntent.getComponent().getClassName());
            assertTrue(activity.isFinishing());
        }
    }

    @Test
    public void onResume_showsEmptyStateWhenOnlySecPalTileIsAvailable() {
        TestDependencies dependencies = new TestDependencies(
            kioskState(false, false),
            Collections.emptyList()
        );

        DedicatedDeviceHomeActivity.setDependenciesForTest(dependencies);

        try (ActivityController<DedicatedDeviceHomeActivity> controller =
            Robolectric.buildActivity(DedicatedDeviceHomeActivity.class).setup()) {
            DedicatedDeviceHomeActivity activity = controller.get();
            GridLayout appGrid = activity.findViewById(R.id.enterprise_home_app_grid);
            TextView emptyState = activity.findViewById(R.id.enterprise_home_empty_state);

            assertEquals(1, appGrid.getChildCount());
            assertEquals(View.VISIBLE, emptyState.getVisibility());
            TextView firstLabel = appGrid.getChildAt(0).findViewById(R.id.enterprise_home_tile_label);
            assertEquals(activity.getString(R.string.enterprise_home_open_secpal), firstLabel.getText().toString());
        }
    }

    @Test
    public void onResume_populatesAllowedAppTilesAndHandlesClicks() {
        TestDependencies dependencies = new TestDependencies(
            kioskState(false, false),
            Collections.singletonList(
                new EnterprisePolicyController.AllowedLaunchApp("com.example.camera", "Camera")
            )
        );

        DedicatedDeviceHomeActivity.setDependenciesForTest(dependencies);

        try (ActivityController<DedicatedDeviceHomeActivity> controller =
            Robolectric.buildActivity(DedicatedDeviceHomeActivity.class).setup()) {
            DedicatedDeviceHomeActivity activity = controller.get();
            GridLayout appGrid = activity.findViewById(R.id.enterprise_home_app_grid);
            TextView emptyState = activity.findViewById(R.id.enterprise_home_empty_state);

            assertEquals(2, appGrid.getChildCount());
            assertEquals(View.GONE, emptyState.getVisibility());
            TextView secondLabel = appGrid.getChildAt(1).findViewById(R.id.enterprise_home_tile_label);
            assertEquals("Camera", secondLabel.getText().toString());

            appGrid.getChildAt(1).performClick();

            assertEquals("com.example.camera", dependencies.launchedAllowedPackage);
        }
    }

    @Test
    public void onResume_showsPhoneTileWhenAllowPhoneEnabledAndDialerResolved() {
        TestDependencies dependencies = new TestDependencies(
            kioskState(true, false),
            Collections.emptyList()
        );
        dependencies.dialerPackage = "com.android.dialer";

        DedicatedDeviceHomeActivity.setDependenciesForTest(dependencies);

        try (ActivityController<DedicatedDeviceHomeActivity> controller =
            Robolectric.buildActivity(DedicatedDeviceHomeActivity.class).setup()) {
            DedicatedDeviceHomeActivity activity = controller.get();
            GridLayout appGrid = activity.findViewById(R.id.enterprise_home_app_grid);
            TextView emptyState = activity.findViewById(R.id.enterprise_home_empty_state);

            assertEquals(2, appGrid.getChildCount());
            assertEquals(View.GONE, emptyState.getVisibility());
            TextView phoneTileLabel = appGrid.getChildAt(1).findViewById(R.id.enterprise_home_tile_label);
            assertEquals(activity.getString(R.string.enterprise_home_phone_label), phoneTileLabel.getText().toString());

            appGrid.getChildAt(1).performClick();

            assertTrue(dependencies.launchPhoneCalled);
        }
    }

    @Test
    public void onResume_omitsPhoneTileWhenDialerNotResolved() {
        TestDependencies dependencies = new TestDependencies(
            kioskState(true, false),
            Collections.emptyList()
        );
        dependencies.dialerPackage = null;

        DedicatedDeviceHomeActivity.setDependenciesForTest(dependencies);

        try (ActivityController<DedicatedDeviceHomeActivity> controller =
            Robolectric.buildActivity(DedicatedDeviceHomeActivity.class).setup()) {
            DedicatedDeviceHomeActivity activity = controller.get();
            GridLayout appGrid = activity.findViewById(R.id.enterprise_home_app_grid);

            assertEquals(1, appGrid.getChildCount());
        }
    }

    @Test
    public void onResume_showsSmsTileWhenAllowSmsEnabledAndSmsPackageResolved() {
        TestDependencies dependencies = new TestDependencies(
            kioskState(false, true),
            Collections.emptyList()
        );
        dependencies.smsPackage = "com.android.mms";

        DedicatedDeviceHomeActivity.setDependenciesForTest(dependencies);

        try (ActivityController<DedicatedDeviceHomeActivity> controller =
            Robolectric.buildActivity(DedicatedDeviceHomeActivity.class).setup()) {
            DedicatedDeviceHomeActivity activity = controller.get();
            GridLayout appGrid = activity.findViewById(R.id.enterprise_home_app_grid);
            TextView emptyState = activity.findViewById(R.id.enterprise_home_empty_state);

            assertEquals(2, appGrid.getChildCount());
            assertEquals(View.GONE, emptyState.getVisibility());
            TextView smsTileLabel = appGrid.getChildAt(1).findViewById(R.id.enterprise_home_tile_label);
            assertEquals(activity.getString(R.string.enterprise_home_sms_label), smsTileLabel.getText().toString());

            appGrid.getChildAt(1).performClick();

            assertTrue(dependencies.launchSmsCalled);
        }
    }

    @Test
    public void onResume_omitsSmsTileWhenSmsPackageNotResolved() {
        TestDependencies dependencies = new TestDependencies(
            kioskState(false, true),
            Collections.emptyList()
        );
        dependencies.smsPackage = null;

        DedicatedDeviceHomeActivity.setDependenciesForTest(dependencies);

        try (ActivityController<DedicatedDeviceHomeActivity> controller =
            Robolectric.buildActivity(DedicatedDeviceHomeActivity.class).setup()) {
            DedicatedDeviceHomeActivity activity = controller.get();
            GridLayout appGrid = activity.findViewById(R.id.enterprise_home_app_grid);

            assertEquals(1, appGrid.getChildCount());
        }
    }

    private static EnterpriseManagedState kioskState(boolean allowPhone, boolean allowSms) {
        return new EnterpriseManagedState(
            EnterpriseManagedState.MODE_DEVICE_OWNER,
            new EnterprisePolicyConfig(true, true, allowPhone, allowSms, false, Collections.emptySet())
        );
    }

    private static final class TestDependencies extends DedicatedDeviceHomeDependencies {
        private final EnterpriseManagedState managedState;
        private final List<EnterprisePolicyController.AllowedLaunchApp> allowedApps;
        private boolean maybeEnterLockTaskCalled;
        private boolean launchPhoneCalled;
        private boolean launchSmsCalled;
        @Nullable
        private String launchedAllowedPackage;
        @Nullable
        String dialerPackage = null;
        @Nullable
        String smsPackage = null;

        TestDependencies(
            EnterpriseManagedState managedState,
            List<EnterprisePolicyController.AllowedLaunchApp> allowedApps
        ) {
            this.managedState = managedState;
            this.allowedApps = allowedApps;
        }

        @Override
        EnterpriseManagedState syncPolicy(DedicatedDeviceHomeActivity activity) {
            return managedState;
        }

        @Override
        void maybeEnterLockTask(DedicatedDeviceHomeActivity activity) {
            maybeEnterLockTaskCalled = true;
        }

        @Override
        List<EnterprisePolicyController.AllowedLaunchApp> resolveAllowedLaunchApps(
            DedicatedDeviceHomeActivity activity
        ) {
            return allowedApps;
        }

        @Override
        void launchAllowedApp(DedicatedDeviceHomeActivity activity, String packageName) {
            launchedAllowedPackage = packageName;
        }

        @Override
        void launchPhone(DedicatedDeviceHomeActivity activity) {
            launchPhoneCalled = true;
        }

        @Override
        void launchSms(DedicatedDeviceHomeActivity activity) {
            launchSmsCalled = true;
        }

        @Override
        String resolveDialerPackage(EnterpriseManagedState state, DedicatedDeviceHomeActivity activity) {
            return dialerPackage;
        }

        @Override
        String resolveSmsPackage(EnterpriseManagedState state, DedicatedDeviceHomeActivity activity) {
            return smsPackage;
        }
    }
}
