/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class EnterprisePolicyControllerPersistenceTest {

    @Test
    public void persistDebugPolicyCommitsSynchronously() {
        RecordingSharedPreferences preferences = new RecordingSharedPreferences();
        Context context = new SharedPreferencesContext(preferences);
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);

        EnterprisePolicyController.persistDebugPolicy(context, values);

        assertTrue(preferences.wasCommitCalled());
        assertFalse(preferences.wasApplyCalled());
        assertTrue(preferences.getBoolean("kiosk_mode_enabled", false));
        assertTrue(preferences.getBoolean("lock_task_enabled", false));
    }

    @Test
    public void clearDebugPolicyCommitsSynchronously() {
        RecordingSharedPreferences preferences = new RecordingSharedPreferences();
        Context context = new SharedPreferencesContext(preferences);

        preferences.edit()
            .putBoolean("kiosk_mode_enabled", true)
            .putBoolean("lock_task_enabled", true)
            .putBoolean("allow_phone", true)
            .commit();
        preferences.resetEditorTracking();

        EnterprisePolicyController.clearDebugPolicy(context);

        assertTrue(preferences.wasCommitCalled());
        assertFalse(preferences.wasApplyCalled());
        assertFalse(preferences.contains("kiosk_mode_enabled"));
        assertFalse(preferences.contains("lock_task_enabled"));
        assertFalse(preferences.contains("allow_phone"));
    }

    private static final class SharedPreferencesContext extends ContextWrapper {
        private final SharedPreferences sharedPreferences;

        private SharedPreferencesContext(SharedPreferences sharedPreferences) {
            super(null);
            this.sharedPreferences = sharedPreferences;
        }

        @Override
        public SharedPreferences getSharedPreferences(String name, int mode) {
            return sharedPreferences;
        }
    }

    private static final class RecordingSharedPreferences implements SharedPreferences {
        private final Map<String, Object> values = new HashMap<>();
        private boolean commitCalled;
        private boolean applyCalled;

        @Override
        public Map<String, ?> getAll() {
            return Collections.unmodifiableMap(values);
        }

        @Override
        public String getString(String key, String defValue) {
            Object value = values.get(key);

            return value instanceof String ? (String) value : defValue;
        }

        @Override
        @SuppressWarnings("unchecked")
        public Set<String> getStringSet(String key, Set<String> defValues) {
            Object value = values.get(key);

            return value instanceof Set ? new HashSet<>((Set<String>) value) : defValues;
        }

        @Override
        public int getInt(String key, int defValue) {
            Object value = values.get(key);

            return value instanceof Integer ? (Integer) value : defValue;
        }

        @Override
        public long getLong(String key, long defValue) {
            Object value = values.get(key);

            return value instanceof Long ? (Long) value : defValue;
        }

        @Override
        public float getFloat(String key, float defValue) {
            Object value = values.get(key);

            return value instanceof Float ? (Float) value : defValue;
        }

        @Override
        public boolean getBoolean(String key, boolean defValue) {
            Object value = values.get(key);

            return value instanceof Boolean ? (Boolean) value : defValue;
        }

        @Override
        public boolean contains(String key) {
            return values.containsKey(key);
        }

        @Override
        public Editor edit() {
            return new RecordingEditor();
        }

        @Override
        public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {
        }

        @Override
        public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {
        }

        boolean wasCommitCalled() {
            return commitCalled;
        }

        boolean wasApplyCalled() {
            return applyCalled;
        }

        void resetEditorTracking() {
            commitCalled = false;
            applyCalled = false;
        }

        private final class RecordingEditor implements Editor {
            private final Map<String, Object> pendingValues = new HashMap<>();
            private final Set<String> removals = new HashSet<>();
            private boolean clearRequested;

            @Override
            public Editor putString(String key, String value) {
                pendingValues.put(key, value);
                removals.remove(key);
                return this;
            }

            @Override
            public Editor putStringSet(String key, Set<String> values) {
                pendingValues.put(key, values == null ? null : new HashSet<>(values));
                removals.remove(key);
                return this;
            }

            @Override
            public Editor putInt(String key, int value) {
                pendingValues.put(key, value);
                removals.remove(key);
                return this;
            }

            @Override
            public Editor putLong(String key, long value) {
                pendingValues.put(key, value);
                removals.remove(key);
                return this;
            }

            @Override
            public Editor putFloat(String key, float value) {
                pendingValues.put(key, value);
                removals.remove(key);
                return this;
            }

            @Override
            public Editor putBoolean(String key, boolean value) {
                pendingValues.put(key, value);
                removals.remove(key);
                return this;
            }

            @Override
            public Editor remove(String key) {
                pendingValues.remove(key);
                removals.add(key);
                return this;
            }

            @Override
            public Editor clear() {
                clearRequested = true;
                pendingValues.clear();
                removals.clear();
                return this;
            }

            @Override
            public boolean commit() {
                commitCalled = true;
                applyPendingChanges();
                return true;
            }

            @Override
            public void apply() {
                applyCalled = true;
            }

            private void applyPendingChanges() {
                if (clearRequested) {
                    values.clear();
                }

                for (String key : removals) {
                    values.remove(key);
                }

                values.putAll(pendingValues);
            }
        }
    }
}
