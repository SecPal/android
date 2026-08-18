/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class BridgeIsolationTestActivity extends MainActivity {
    @Override
    void createSecureBridge() {
        createSecureBridge(CountingEnterprisePlugin.class);
    }

    static void resetInvocations() {
        CountingEnterprisePlugin.resetInvocations();
    }

    static List<String> invocations() {
        return CountingEnterprisePlugin.invocations();
    }

    @CapacitorPlugin(name = "SecPalEnterprise")
    public static final class CountingEnterprisePlugin extends SecPalEnterprisePlugin {
        private static final List<String> INVOCATIONS = Collections.synchronizedList(
            new ArrayList<>()
        );

        @Override
        @PluginMethod
        public void getManagedState(PluginCall call) {
            INVOCATIONS.add(call.getCallbackId());
            call.resolve(new JSObject());
        }

        static void resetInvocations() {
            INVOCATIONS.clear();
        }

        static List<String> invocations() {
            synchronized (INVOCATIONS) {
                return new ArrayList<>(INVOCATIONS);
            }
        }
    }
}
