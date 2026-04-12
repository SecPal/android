/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;
import android.util.Log;
import android.view.KeyEvent;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "SecPalEnterprise")
public class SecPalEnterprisePlugin extends Plugin {
    static final long HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS = 5000L;
    static final String HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH = "activity_dispatch";
    static final String HARDWARE_BUTTON_ORIGIN_SAMSUNG_KNOX_BROADCAST = "samsung_knox_broadcast";
    private static final String LOG_TAG = "SecPalHardwareButtons";
    private static final String HARDWARE_BUTTON_PRESSED_EVENT = "hardwareButtonPressed";
    private static final String HARDWARE_BUTTON_SHORT_PRESSED_EVENT = "hardwareButtonShortPressed";
    private static final String HARDWARE_BUTTON_LONG_PRESSED_EVENT = "hardwareButtonLongPressed";
    private static volatile SecPalEnterprisePlugin activeInstance;
    private static final Map<String, Long> activeButtonPressStartedAt = new ConcurrentHashMap<>();
    private static final Object PENDING_HARDWARE_BUTTON_EVENTS_LOCK = new Object();
    private static final List<PendingHardwareButtonEvent> pendingHardwareButtonEvents = new ArrayList<>();

    @Override
    public void load() {
        super.load();
        activeButtonPressStartedAt.clear();
        activeInstance = this;
        flushPendingHardwareButtonEvents();
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
            HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH,
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
        String origin,
        int action,
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source,
        long eventTime,
        boolean canceled
    ) {
        String buttonKey = buildHardwareButtonKey(keyCode, scanCode, deviceId, source);

        if (action == KeyEvent.ACTION_DOWN) {
            if (!shouldEmitHardwareButtonEvent(action, keyCode, repeatCount, canceled)) {
                return;
            }

            activeButtonPressStartedAt.put(buttonKey, eventTime);
            dispatchOrQueueHardwareButtonEvent(
                HARDWARE_BUTTON_PRESSED_EVENT,
                buildHardwareButtonEventMap(origin, action, keyCode, scanCode, repeatCount, deviceId, source)
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
            dispatchOrQueueHardwareButtonEvent(
                HARDWARE_BUTTON_SHORT_PRESSED_EVENT,
                buildHardwareButtonShortPressEventMap(
                    origin,
                    keyCode,
                    scanCode,
                    repeatCount,
                    deviceId,
                    source,
                    holdDurationMs
                )
            );
            return;
        }

        if (!shouldEmitHardwareButtonLongPress(action, keyCode, repeatCount, canceled, holdDurationMs)) {
            return;
        }

        dispatchOrQueueHardwareButtonEvent(
            HARDWARE_BUTTON_LONG_PRESSED_EVENT,
            buildHardwareButtonLongPressEventMap(
                origin,
                keyCode,
                scanCode,
                repeatCount,
                deviceId,
                source,
                holdDurationMs
            )
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
        emitHardwareButtonEvent(
            HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH,
            action,
            keyCode,
            scanCode,
            repeatCount,
            deviceId,
            source,
            eventTime,
            canceled
        );
    }

    static void emitSamsungKnoxHardwareButtonEvent(int keyCode) {
        dispatchOrQueueHardwareButtonEvent(
            HARDWARE_BUTTON_PRESSED_EVENT,
            buildSamsungKnoxHardwareButtonEventMap(keyCode)
        );
    }

    static void emitSamsungKnoxHardwareButtonShortPressEvent(int keyCode) {
        dispatchOrQueueHardwareButtonEvent(
            HARDWARE_BUTTON_SHORT_PRESSED_EVENT,
            buildSamsungKnoxHardwareButtonShortPressEventMap(keyCode)
        );
    }

    static void emitSamsungKnoxHardwareButtonLongPressEvent(int keyCode) {
        dispatchOrQueueHardwareButtonEvent(
            HARDWARE_BUTTON_LONG_PRESSED_EVENT,
            buildSamsungKnoxHardwareButtonLongPressEventMap(keyCode)
        );
    }

    static boolean shouldEmitHardwareButtonEvent(KeyEvent event) {
        if (event == null) {
            return false;
        }

        return shouldEmitHardwareButtonEvent(
            event.getAction(),
            event.getKeyCode(),
            event.getRepeatCount(),
            event.isCanceled()
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

    static Map<String, Object> buildHardwareButtonEventMap(KeyEvent event) {
        if (event == null) {
            throw new IllegalArgumentException("Hardware button event is required");
        }

        return buildHardwareButtonEventMap(
            event.getAction(),
            event.getKeyCode(),
            event.getScanCode(),
            event.getRepeatCount(),
            event.getDeviceId(),
            event.getSource()
        );
    }

    static Map<String, Object> buildHardwareButtonEventMap(
        int action,
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source
    ) {
        return buildHardwareButtonEventMap(
            HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH,
            action,
            keyCode,
            scanCode,
            repeatCount,
            deviceId,
            source
        );
    }

    static Map<String, Object> buildHardwareButtonEventMap(
        String origin,
        int action,
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source
    ) {
        LinkedHashMap<String, Object> payload = new LinkedHashMap<>();

        payload.put("action", action == KeyEvent.ACTION_DOWN ? "down" : "unknown");
        payload.put("origin", origin);
        payload.put("keyCode", keyCode);
        payload.put("keyName", resolveKeyName(keyCode));
        payload.put("scanCode", scanCode);
        payload.put("repeatCount", repeatCount);
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
        return buildHardwareButtonLongPressEventMap(
            HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH,
            keyCode,
            scanCode,
            repeatCount,
            deviceId,
            source,
            holdDurationMs
        );
    }

    static Map<String, Object> buildHardwareButtonShortPressEventMap(
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source,
        long holdDurationMs
    ) {
        return buildHardwareButtonShortPressEventMap(
            HARDWARE_BUTTON_ORIGIN_ACTIVITY_DISPATCH,
            keyCode,
            scanCode,
            repeatCount,
            deviceId,
            source,
            holdDurationMs
        );
    }

    static Map<String, Object> buildHardwareButtonShortPressEventMap(
        String origin,
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source,
        long holdDurationMs
    ) {
        LinkedHashMap<String, Object> payload = new LinkedHashMap<>();

        payload.put("action", "short_press");
        payload.put("origin", origin);
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
        String origin,
        int keyCode,
        int scanCode,
        int repeatCount,
        int deviceId,
        int source,
        long holdDurationMs
    ) {
        LinkedHashMap<String, Object> payload = new LinkedHashMap<>();

        payload.put("action", "long_press");
        payload.put("origin", origin);
        payload.put("keyCode", keyCode);
        payload.put("keyName", resolveKeyName(keyCode));
        payload.put("scanCode", scanCode);
        payload.put("repeatCount", repeatCount);
        payload.put("holdDurationMs", holdDurationMs);
        payload.put("deviceId", deviceId);
        payload.put("source", source);

        return payload;
    }

    static Map<String, Object> buildSamsungKnoxHardwareButtonEventMap(int keyCode) {
        return buildHardwareButtonEventMap(
            HARDWARE_BUTTON_ORIGIN_SAMSUNG_KNOX_BROADCAST,
            KeyEvent.ACTION_DOWN,
            keyCode,
            -1,
            0,
            -1,
            0
        );
    }

    static Map<String, Object> buildSamsungKnoxHardwareButtonShortPressEventMap(int keyCode) {
        return buildHardwareButtonShortPressEventMap(
            HARDWARE_BUTTON_ORIGIN_SAMSUNG_KNOX_BROADCAST,
            keyCode,
            -1,
            0,
            -1,
            0,
            0L
        );
    }

    static Map<String, Object> buildSamsungKnoxHardwareButtonLongPressEventMap(int keyCode) {
        return buildHardwareButtonLongPressEventMap(
            HARDWARE_BUTTON_ORIGIN_SAMSUNG_KNOX_BROADCAST,
            keyCode,
            -1,
            0,
            -1,
            0,
            HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS
        );
    }

    private static void dispatchOrQueueHardwareButtonEvent(String eventName, Map<String, Object> payload) {
        Log.i(
            LOG_TAG,
            "Hardware button event=" + eventName
                + " origin=" + payload.get("origin")
                + " keyCode=" + payload.get("keyCode")
        );

        SecPalEnterprisePlugin plugin = activeInstance;

        if (plugin != null) {
            plugin.notifyListeners(eventName, toJsObject(payload), true);
            return;
        }

        synchronized (PENDING_HARDWARE_BUTTON_EVENTS_LOCK) {
            pendingHardwareButtonEvents.add(new PendingHardwareButtonEvent(eventName, payload));
        }
    }

    private void flushPendingHardwareButtonEvents() {
        List<PendingHardwareButtonEvent> retainedEvents;

        synchronized (PENDING_HARDWARE_BUTTON_EVENTS_LOCK) {
            if (pendingHardwareButtonEvents.isEmpty()) {
                return;
            }

            retainedEvents = new ArrayList<>(pendingHardwareButtonEvents);
            pendingHardwareButtonEvents.clear();
        }

        for (PendingHardwareButtonEvent event : retainedEvents) {
            notifyListeners(event.eventName, toJsObject(event.payload), true);
        }
    }

    private static final class PendingHardwareButtonEvent {
        private final String eventName;
        private final Map<String, Object> payload;

        private PendingHardwareButtonEvent(String eventName, Map<String, Object> payload) {
            this.eventName = eventName;
            this.payload = new LinkedHashMap<>(payload);
        }
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
                case 286:
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
