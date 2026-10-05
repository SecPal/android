/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import io.secpal.dpc.BuildConfig;

/** Read-only, certificate-authenticated management state. No request can mutate management policy. */
public final class DpcManagementProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    @Override public Bundle call(String method, String arg, Bundle extras) {
        return readForCaller(getContext(), Binder.getCallingUid(), BuildConfig.WORK_APPLICATION_ID,
            BuildConfig.WORK_CERT_SHA256, method, arg, extras);
    }

    static Bundle readForCaller(android.content.Context context, int uid, String workPackage,
        String certificate, String method, String arg, Bundle extras) {
        if (!ManagementPackageIdentity.isExclusiveCaller(context, uid, workPackage, certificate)) {
            throw new SecurityException("Untrusted management-state consumer");
        }
        if (!ManagementSnapshot.METHOD.equals(method) || arg != null || extras != null) {
            throw new IllegalArgumentException("Only fresh management state is supported");
        }
        return ManagementSnapshot.encode(context, DpcPolicyState.read(context));
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        throw new UnsupportedOperationException("Use the authenticated state method");
    }
    @Override public String getType(Uri uri) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
}
