/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.LinkedHashMap;
import java.util.Map;

@CapacitorPlugin(name = "SecPalEnterprise")
public class SecPalEnterprisePlugin extends Plugin {

    @PluginMethod
    public void getManagedState(PluginCall call) {
        EnterpriseManagedState managedState = EnterprisePolicyController.syncPolicy(getContext());
        JSObject payload = new JSObject();
        boolean phoneAvailable = managedState.isAllowPhone()
            && managedState.resolveDialerPackage(getContext()) != null;
        boolean smsAvailable = managedState.isAllowSms()
            && managedState.resolveSmsPackage(getContext()) != null;

        payload.put("managed", managedState.isManaged());
        payload.put("mode", managedState.getMode());
        payload.put("kioskActive", managedState.isKioskActive());
        payload.put("lockTaskEnabled", managedState.isLockTaskEnabled());
        payload.put("allowPhone", phoneAvailable);
        payload.put("allowSms", smsAvailable);
        payload.put(
            "gestureNavigationEnabled",
            SystemNavigationController.isGestureNavigationEnabled(getContext())
        );
        payload.put(
            "gestureNavigationSettingsAvailable",
            SystemNavigationController.canOpenGestureNavigationSettings(getContext())
        );
        payload.put(
            "distributionState",
            toJsObject(buildDistributionStateMap(resolveProvisioningBootstrapState()))
        );

        JSArray allowedApps = new JSArray();

        for (EnterprisePolicyController.AllowedLaunchApp allowedApp
            : EnterprisePolicyController.resolveAllowedLaunchApps(getContext())) {
            JSObject entry = new JSObject();

            entry.put("packageName", allowedApp.getPackageName());
            entry.put("label", allowedApp.getLabel());
            allowedApps.put(entry);
        }

        payload.put("allowedApps", allowedApps);

        call.resolve(payload);
    }

    static Map<String, Object> buildDistributionStateMap(ProvisioningBootstrapState state) {
        LinkedHashMap<String, Object> payload = new LinkedHashMap<>();

        payload.put("bootstrapStatus", state.getStatus());
        payload.put("updateChannel", state.getUpdateChannel());
        payload.put("releaseMetadataUrl", state.getReleaseMetadataUrl());
        payload.put("bootstrapLastErrorCode", state.getLastErrorCode());

        return payload;
    }

    private ProvisioningBootstrapState resolveProvisioningBootstrapState() {
        try {
            return ProvisioningBootstrapStore.fromContext(getContext()).getState();
        } catch (TokenStorageException exception) {
            return new ProvisioningBootstrapState(
                ProvisioningBootstrapState.STATUS_FAILED,
                null,
                null,
                null,
                null,
                null,
                0,
                ProvisioningBootstrapCoordinator.TOKEN_STORAGE_ERROR_CODE
            );
        }
    }

    private static JSObject toJsObject(Map<String, Object> values) {
        JSObject payload = new JSObject();

        for (Map.Entry<String, Object> entry : values.entrySet()) {
            payload.put(entry.getKey(), entry.getValue());
        }

        return payload;
    }

    @PluginMethod
    public void launchPhone(PluginCall call) {
        if (EnterprisePolicyController.launchPhone(getContext())) {
            call.resolve();
            return;
        }

        call.reject("Phone launch is not available", "ENTERPRISE_ACTION_NOT_ALLOWED");
    }

    @PluginMethod
    public void launchSms(PluginCall call) {
        if (EnterprisePolicyController.launchSms(getContext())) {
            call.resolve();
            return;
        }

        call.reject("SMS launch is not available", "ENTERPRISE_ACTION_NOT_ALLOWED");
    }

    @PluginMethod
    public void launchAllowedApp(PluginCall call) {
        String packageName = call.getString("packageName");

        if (EnterprisePolicyController.launchAllowedApp(getContext(), packageName)) {
            call.resolve();
            return;
        }

        call.reject("Allowed app launch is not available", "ENTERPRISE_ACTION_NOT_ALLOWED");
    }

    @PluginMethod
    public void openGestureNavigationSettings(PluginCall call) {
        Activity activity = getActivity();

        if (activity == null) {
            call.reject("Gesture navigation settings require an active Android activity", "ACTIVITY_UNAVAILABLE");
            return;
        }

        if (!SystemNavigationController.canOpenGestureNavigationSettings(getContext())) {
            call.reject(
                "Gesture navigation settings are unavailable on this device",
                "ENTERPRISE_ACTION_NOT_ALLOWED"
            );
            return;
        }

        if (!EnterprisePolicyController.temporarilyExitLockTask(activity)) {
            call.reject(
                "SecPal could not leave lock task to open gesture navigation settings",
                "LOCK_TASK_EXIT_FAILED"
            );
            return;
        }

        if (!SystemNavigationController.openGestureNavigationSettings(activity)) {
            EnterprisePolicyController.maybeEnterLockTask(activity);
            call.reject(
                "Gesture navigation settings could not be opened",
                "ENTERPRISE_ACTION_NOT_ALLOWED"
            );
            return;
        }

        JSObject payload = new JSObject();

        payload.put("opened", true);
        payload.put("gestureNavigationEnabled", SystemNavigationController.isGestureNavigationEnabled(getContext()));
        payload.put("willReenterLockTaskOnResume", true);

        call.resolve(payload);
    }
}
