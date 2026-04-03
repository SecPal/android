/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.Telephony;
import android.telecom.TelecomManager;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class EnterpriseManagedState {
    static final String MODE_NONE = "none";
    static final String MODE_PROFILE_OWNER = "profile_owner";
    static final String MODE_DEVICE_OWNER = "device_owner";

    private final String mode;
    private final EnterprisePolicyConfig policyConfig;

    EnterpriseManagedState(String mode, EnterprisePolicyConfig policyConfig) {
        this.mode = mode;
        this.policyConfig = policyConfig;
    }

    public String getMode() {
        return mode;
    }

    public boolean isManaged() {
        return !MODE_NONE.equals(mode);
    }

    public boolean isProfileOwner() {
        return MODE_PROFILE_OWNER.equals(mode);
    }

    public boolean isDeviceOwner() {
        return MODE_DEVICE_OWNER.equals(mode);
    }

    public boolean isKioskActive() {
        return isDeviceOwner() && policyConfig.isKioskModeEnabled();
    }

    public boolean isLockTaskEnabled() {
        return isKioskActive() && policyConfig.isLockTaskEnabled();
    }

    public boolean isAllowPhone() {
        return policyConfig.isAllowPhone();
    }

    public boolean isAllowSms() {
        return policyConfig.isAllowSms();
    }

    public boolean isPreferGestureNavigation() {
        return isKioskActive() && policyConfig.isPreferGestureNavigation();
    }

    public Set<String> resolveAllowedPackages(Context context) {
        LinkedHashSet<String> allowedPackages = new LinkedHashSet<>();

        allowedPackages.add(context.getPackageName());
        allowedPackages.addAll(policyConfig.getAdditionalAllowedPackages());

        String dialerPackage = resolveDialerPackage(context);
        if (policyConfig.isAllowPhone() && dialerPackage != null) {
            allowedPackages.add(dialerPackage);
        }

        if (policyConfig.isAllowPhone()) {
            allowedPackages.addAll(resolveContactSupportPackages(context));
        }

        String smsPackage = resolveSmsPackage(context);
        if (policyConfig.isAllowSms() && smsPackage != null) {
            allowedPackages.add(smsPackage);
        }

        return allowedPackages;
    }

    String resolveDialerPackage(Context context) {
        TelecomManager telecomManager = context.getSystemService(TelecomManager.class);

        if (telecomManager != null) {
            String defaultDialerPackage = telecomManager.getDefaultDialerPackage();

            if (defaultDialerPackage != null && !defaultDialerPackage.trim().isEmpty()) {
                return defaultDialerPackage;
            }
        }

        return resolveHandlerPackage(
            context,
            new Intent(Intent.ACTION_DIAL, Uri.parse("tel:123"))
        );
    }

    String resolveSmsPackage(Context context) {
        String defaultSmsPackage = Telephony.Sms.getDefaultSmsPackage(context);

        if (defaultSmsPackage != null && !defaultSmsPackage.trim().isEmpty()) {
            return defaultSmsPackage;
        }

        return resolveHandlerPackage(
            context,
            new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:123"))
        );
    }

    Set<String> resolveContactSupportPackages(Context context) {
        LinkedHashSet<String> packages = new LinkedHashSet<>();
        PackageManager packageManager = context.getPackageManager();
        ProviderInfo contactsProvider = packageManager.resolveContentProvider(
            ContactsContract.AUTHORITY,
            0
        );

        if (contactsProvider != null && contactsProvider.packageName != null) {
            packages.add(contactsProvider.packageName);
        }

        for (Intent intent : buildContactEditorIntents()) {
            for (ResolveInfo resolveInfo : packageManager.queryIntentActivities(intent, 0)) {
                if (resolveInfo.activityInfo != null && resolveInfo.activityInfo.packageName != null) {
                    packages.add(resolveInfo.activityInfo.packageName);
                }
            }
        }

        return packages;
    }

    private static List<Intent> buildContactEditorIntents() {
        List<Intent> intents = new ArrayList<>();

        intents.add(new Intent(Intent.ACTION_INSERT).setType(ContactsContract.Contacts.CONTENT_TYPE));
        intents.add(
            new Intent(Intent.ACTION_INSERT_OR_EDIT)
                .setType(ContactsContract.RawContacts.CONTENT_ITEM_TYPE)
        );
        intents.add(
            new Intent(Intent.ACTION_INSERT_OR_EDIT)
                .setType(ContactsContract.Contacts.CONTENT_ITEM_TYPE)
        );

        return intents;
    }

    private static String resolveHandlerPackage(Context context, Intent intent) {
        PackageManager packageManager = context.getPackageManager();
        ResolveInfo resolveInfo = packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);

        if (resolveInfo != null && resolveInfo.activityInfo != null) {
            return resolveInfo.activityInfo.packageName;
        }

        android.content.ComponentName fallbackComponent = EnterprisePolicyController.resolveFirstComponent(
            packageManager.queryIntentActivities(intent, 0)
        );

        if (fallbackComponent == null) {
            return null;
        }

        return fallbackComponent.getPackageName();
    }
}
