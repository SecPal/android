/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

final class SamsungHardKeyContract {
    static final String ACTION_HARD_KEY_PRESS =
        "com.samsung.android.knox.intent.action.HARD_KEY_PRESS";
    static final String ACTION_HARD_KEY_REPORT =
        "com.samsung.android.knox.intent.action.HARD_KEY_REPORT";
    static final String EXTRA_KEY_CODE =
        "com.samsung.android.knox.intent.extra.KEY_CODE";
    static final String EXTRA_REPORT_TYPE =
        "com.samsung.android.knox.intent.extra.KEY_REPORT_TYPE";
    static final String EXTRA_REPORT_TYPE_NEW =
        "com.samsung.android.knox.intent.extra.KEY_REPORT_TYPE_NEW";
    static final String EXTRA_REPORT_TYPE_NEW_LONG_UP =
        "com.samsung.android.knox.intent.extra.EXTRA_REPORT_TYPE_NEW_LONG_UP";
    static final int SAMSUNG_KEY_CODE_XCOVER = 1015;
    static final int SAMSUNG_KEY_CODE_SOS = 1079;
    static final int REPORT_TYPE_DOWN = 1;
    static final int REPORT_TYPE_UP = 2;
    static final int REPORT_TYPE_DOWN_UP = 3;
    static final int REPORT_TYPE_LONG = 4;

    private SamsungHardKeyContract() {}
}
