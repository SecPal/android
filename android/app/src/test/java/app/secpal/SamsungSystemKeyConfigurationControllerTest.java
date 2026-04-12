/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public class SamsungSystemKeyConfigurationControllerTest {

    @Test
    public void applyManagedStateContinuesAfterSecureSettingFailure() {
        RecordingSettingWriter writer = new RecordingSettingWriter(true);

        int failedWrites = SamsungSystemKeyConfigurationController.applyManagedState(
            writer,
            "app.secpal",
            "SecPal"
        );

        assertEquals(1, failedWrites);
        assertEquals(
            Arrays.asList(
                "int:active_key_on_lockscreen=1",
                "string:dedicated_app_label_xcover=SecPal",
                "string:dedicated_app_xcover=app.secpal/app.secpal.ProfileHardwareTriggerActivity",
                "int:dedicated_app_xcover_switch=1",
                "string:short_press_app=app.secpal/app.secpal.ProfileHardwareTriggerActivity",
                "string:long_press_app=app.secpal/app.secpal.AboutHardwareTriggerActivity"
            ),
            writer.operations
        );
    }

    @Test
    public void applyManagedStateSucceedsWhenAllWritesSucceed() {
        RecordingSettingWriter writer = new RecordingSettingWriter(false);

        int failedWrites = SamsungSystemKeyConfigurationController.applyManagedState(
            writer,
            "app.secpal",
            "SecPal"
        );

        assertEquals(0, failedWrites);
        assertEquals(6, writer.operations.size());
    }

    private static final class RecordingSettingWriter
        implements SamsungSystemKeyConfigurationController.SettingWriter {
        private final boolean failSecureWrite;
        private final List<String> operations = new ArrayList<>();
        private boolean secureWriteFailed;

        private RecordingSettingWriter(boolean failSecureWrite) {
            this.failSecureWrite = failSecureWrite;
        }

        @Override
        public void putInt(String key, int value) {
            operations.add("int:" + key + "=" + value);

            if (
                failSecureWrite
                    && !secureWriteFailed
                    && "active_key_on_lockscreen".equals(key)
            ) {
                secureWriteFailed = true;
                throw new IllegalArgumentException("secure write blocked");
            }
        }

        @Override
        public void putString(String key, String value) {
            operations.add("string:" + key + "=" + value);
        }
    }
}
