/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
package app.secpal;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/** Native entry boundary until authenticated Endpoint Authority is implemented. */
public final class WorkActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView message = new TextView(this);
        message.setId(android.R.id.message);
        message.setText(R.string.work_endpoint_authority_unavailable);
        message.setGravity(android.view.Gravity.CENTER);
        setContentView(message);
    }
}
