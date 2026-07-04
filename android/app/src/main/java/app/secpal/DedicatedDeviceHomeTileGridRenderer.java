/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.TextView;

import java.util.List;

final class DedicatedDeviceHomeTileGridRenderer {
    private final LayoutInflater layoutInflater;

    DedicatedDeviceHomeTileGridRenderer(LayoutInflater layoutInflater) {
        this.layoutInflater = layoutInflater;
    }

    void render(GridLayout appGrid, List<DedicatedDeviceHomeTileModel> tiles) {
        appGrid.removeAllViews();

        for (DedicatedDeviceHomeTileModel tile : tiles) {
            appGrid.addView(createTileView(appGrid, tile));
        }
    }

    private View createTileView(ViewGroup parent, DedicatedDeviceHomeTileModel tile) {
        View tileView = layoutInflater.inflate(
            R.layout.view_dedicated_device_home_tile,
            parent,
            false
        );

        // Explicitly enforce equal-width column spec so tiles always fill the grid
        // regardless of how the LayoutParams were constructed from XML.
        if (tileView.getLayoutParams() instanceof GridLayout.LayoutParams) {
            GridLayout.LayoutParams params = (GridLayout.LayoutParams) tileView.getLayoutParams();
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
            tileView.setLayoutParams(params);
        }

        ImageView iconView = tileView.findViewById(R.id.enterprise_home_tile_icon);
        TextView labelView = tileView.findViewById(R.id.enterprise_home_tile_label);

        iconView.setImageDrawable(tile.getIcon());
        labelView.setText(tile.getLabel());
        tileView.setOnClickListener(tile.getClickListener());

        return tileView;
    }
}
