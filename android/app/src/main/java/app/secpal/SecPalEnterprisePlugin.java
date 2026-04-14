/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;
import android.view.KeyEvent;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "SecPalEnterprise")
public class SecPalEnterprisePlugin extends Plugin {
    static final long HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS = 5000L;
    static final String HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH = "activity_dispatch";
    private static final String HARDWARE_BUTTON_PRESSED_EVENT = "hardwareButtonPressed";
    private static final String HARDWARE_BUTTON_SHORT_PRESSED_EVENT = "hardwareButtonShortPressed";
    private static final String HARDWARE_BUTTON_LONG_PRESSED_EVENT = "hardwareButtonLongPressed";
    private static volatile SecPalEnterprisePlugin activeInstance;
    private static final Map<String, Long> activeButtonPressStartedAt = new ConcurrentHashMap<>();

    @Override
    public void load() {
        super.load();
        activeButtonPressStartedAt.clear();
        activeInstance = this;
    }

    @Override
    protected void handleOnDestroy() {
        activeButtonPressStartedAt.clear();

        if (activeInstance == this) {
            activeInstance = null;
        }

        super.handleOnDestroy();
    }

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

    static void emitHardwareButtonEvent(KeyEvent event) {
        if (event == null) {
            return;
        }

        emitHardwareButtonEvent(
            event.getAction(),
            event.getKeyCode(),
            event.getScanCode(),
            event.getRepeatCount(),
            event.getDeviceId(),
            event.getSource(),
            event.getEventTime(),
            event.isCanceled()
        );
    }

    static void emitHardwareButtonEvent(
        int action,
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source,
        long eventTime,
        boolean canceled
    ) {
        SecPalEnterprisePlugin plugin = activeInstance;

        if (plugin == null) {
            return;
        }

        String buttonKey = buildHardwareButtonKey(keyCode, scanCode, deviceId, source);

        if (action == KeyEvent.ACTION_DOWN) {
            if (!shouldEmitHardwareButtonEvent(action, keyCode, repeatCount, canceled)) {
                return;
            }

            activeButtonPressStartedAt.put(buttonKey, eventTime);
            plugin.notifyListeners(
                HARDWARE_BUTTON_PRESSED_EVENT,
                toJsObject(buildHardwareButtonEventMap(action, keyCode, scanCode, repeatCount, deviceId, source)),
                true
            );
            return;
        }

        if (action != KeyEvent.ACTION_UP) {
            if (canceled) {
                activeButtonPressStartedAt.remove(buttonKey);
            }

            return;
        }

        Long pressedAt = activeButtonPressStartedAt.remove(buttonKey);

        if (pressedAt == null) {
            return;
        }

        long holdDurationMs = Math.max(0L, eventTime - pressedAt.longValue());

        if (shouldEmitHardwareButtonShortPress(action, keyCode, repeatCount, canceled, holdDurationMs)) {
            plugin.notifyListeners(
                HARDWARE_BUTTON_SHORT_PRESSED_EVENT,
                toJsObject(
                    buildHardwareButtonShortPressEventMap(
                        keyCode,
                        scanCode,
                        repeatCount,
                        deviceId,
                        source,
                        holdDurationMs
                    )
                ),
                true
            );
            return;
        }

        if (!shouldEmitHardwareButtonLongPress(action, keyCode, repeatCount, canceled, holdDurationMs)) {
            return;
        }

        plugin.notifyListeners(
            HARDWARE_BUTTON_LONG_PRESSED_EVENT,
            toJsObject(
                buildHardwareButtonLongPressEventMap(
                    keyCode,
                    scanCode,
                    repeatCount,
                    deviceId,
                    source,
                    holdDurationMs
                )
            ),
            true
        );
    }

    static boolean shouldEmitHardwareButtonEvent(int action, int keyCode, int repeatCount, boolean canceled) {
        if (action != KeyEvent.ACTION_DOWN) {
            return false;
        }

        if (canceled || repeatCount > 0) {
            return false;
        }

        return !isSystemKeyCode(keyCode);
    }

    static boolean shouldEmitHardwareButtonLongPress(
        int action,
        int keyCode,
        int repeatCount,
        boolean canceled,
        long holdDurationMs
    ) {
        if (action != KeyEvent.ACTION_UP) {
            return false;
        }

        if (canceled || repeatCount > 0) {
            return false;
        }

        if (holdDurationMs < HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS) {
            return false;
        }

        return !isSystemKeyCode(keyCode);
    }

    static boolean shouldEmitHardwareButtonShortPress(
        int action,
        int keyCode,
        int repeatCount,
        boolean canceled,
        long holdDurationMs
    ) {
        if (action != KeyEvent.ACTION_UP) {
            return false;
        }

        if (canceled || repeatCount > 0) {
            return false;
        }

        if (holdDurationMs >= HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS) {
            return false;
        }

        return !isSystemKeyCode(keyCode);
    }

    static Map<String, Object> buildHardwareButtonEventMap(
        int action,
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source
    ) {
        LinkedHashMap<String, Object> payload = new LinkedHashMap<>();

        payload.put("action", action == KeyEvent.ACTION_DOWN ? "down" : "unknown");
        payload.put("origin", HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH);
        payload.put("keyCode", keyCode);
        payload.put("keyName", resolveKeyName(keyCode));
        payload.put("scanCode", scanCode);
        payload.put("repeatCount", repeatCount);
        payload.put("deviceId", deviceId);
        payload.put("source", source);

        return payload;
    }

    static Map<String, Object> buildHardwareButtonShortPressEventMap(
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source,
        long holdDurationMs
    ) {
        LinkedHashMap<String, Object> payload = new LinkedHashMap<>();

        payload.put("action", "short_press");
        payload.put("origin", HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH);
        payload.put("keyCode", keyCode);
        payload.put("keyName", resolveKeyName(keyCode));
        payload.put("scanCode", scanCode);
        payload.put("repeatCount", repeatCount);
        payload.put("holdDurationMs", holdDurationMs);
        payload.put("deviceId", deviceId);
        payload.put("source", source);

        return payload;
    }

    static Map<String, Object> buildHardwareButtonLongPressEventMap(
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source,
        long holdDurationMs
    ) {
        LinkedHashMap<String, Object> payload = new LinkedHashMap<>();

        payload.put("action", "long_press");
        payload.put("origin", HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH);
        payload.put("keyCode", keyCode);
        payload.put("keyName", resolveKeyName(keyCode));
        payload.put("scanCode", scanCode);
        payload.put("repeatCount", repeatCount);
        payload.put("holdDurationMs", holdDurationMs);
        payload.put("deviceId", deviceId);
        payload.put("source", source);

        return payload;
    }

    private static String buildHardwareButtonKey(int keyCode, int scanCode, int deviceId, int source) {
        return keyCode + ":" + scanCode + ":" + deviceId + ":" + source;
    }

    private static String resolveKeyName(int keyCode) {
        try {
            return KeyEvent.keyCodeToString(keyCode);
        } catch (RuntimeException exception) {
            switch (keyCode) {
                case KeyEvent.KEYCODE_BACK:
                    return "KEYCODE_BACK";
                case KeyEvent.KEYCODE_HOME:
                    return "KEYCODE_HOME";
                case KeyEvent.KEYCODE_MENU:
                    return "KEYCODE_MENU";
                case KeyEvent.KEYCODE_POWER:
                    return "KEYCODE_POWER";
                case KeyEvent.KEYCODE_VOLUME_DOWN:
                    return "KEYCODE_VOLUME_DOWN";
                case KeyEvent.KEYCODE_VOLUME_UP:
                    return "KEYCODE_VOLUME_UP";
                case KeyEvent.KEYCODE_VOLUME_MUTE:
                    return "KEYCODE_VOLUME_MUTE";
                case KeyEvent.KEYCODE_APP_SWITCH:
                    return "KEYCODE_APP_SWITCH";
                case KeyEvent.KEYCODE_STEM_PRIMARY:
                    return "KEYCODE_STEM_PRIMARY";
                default:
                    return "KEYCODE_" + keyCode;
            }
        }
    }

    private static boolean isSystemKeyCode(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_HOME:
            case KeyEvent.KEYCODE_POWER:
            case KeyEvent.KEYCODE_VOLUME_DOWN:
            case KeyEvent.KEYCODE_VOLUME_UP:
            case KeyEvent.KEYCODE_VOLUME_MUTE:
            case KeyEvent.KEYCODE_APP_SWITCH:
            case KeyEvent.KEYCODE_MENU:
                return true;
            default:
                return false;
        }
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
