/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.ComponentName;
import android.content.Intent;

import java.util.HashMap;
import java.util.Map;

/**
 * Minimal Intent stub for unit tests. Avoids Robolectric for the simple
 * extras + action + component behaviour exercised by Samsung hard-key tests.
 */
final class FakeIntent extends Intent {
    private final Map<String, Object> extras = new HashMap<>();
    private String action;
    private ComponentName componentName;

    FakeIntent() {
    }

    FakeIntent(String action) {
        this.action = action;
    }

    @Override
    public String getAction() {
        return action;
    }

    @Override
    public Intent setAction(String action) {
        this.action = action;
        return this;
    }

    @Override
    public ComponentName getComponent() {
        return componentName;
    }

    @Override
    public Intent setComponent(ComponentName componentName) {
        this.componentName = componentName;
        return this;
    }

    @Override
    public boolean hasExtra(String name) {
        return extras.containsKey(name);
    }

    @Override
    public String getStringExtra(String name) {
        Object value = extras.get(name);

        return value instanceof String ? (String) value : null;
    }

    @Override
    public boolean getBooleanExtra(String name, boolean defaultValue) {
        Object value = extras.get(name);

        return value instanceof Boolean ? ((Boolean) value).booleanValue() : defaultValue;
    }

    @Override
    public int getIntExtra(String name, int defaultValue) {
        Object value = extras.get(name);

        return value instanceof Integer ? ((Integer) value).intValue() : defaultValue;
    }

    @Override
    public Intent putExtra(String name, String value) {
        extras.put(name, value);
        return this;
    }

    @Override
    public Intent putExtra(String name, boolean value) {
        extras.put(name, Boolean.valueOf(value));
        return this;
    }

    @Override
    public Intent putExtra(String name, int value) {
        extras.put(name, Integer.valueOf(value));
        return this;
    }
}
