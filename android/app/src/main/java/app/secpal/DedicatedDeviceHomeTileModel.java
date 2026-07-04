/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.graphics.drawable.Drawable;
import android.view.View;

final class DedicatedDeviceHomeTileModel {
    private final String label;
    private final Drawable icon;
    private final View.OnClickListener clickListener;

    DedicatedDeviceHomeTileModel(String label, Drawable icon, View.OnClickListener clickListener) {
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
