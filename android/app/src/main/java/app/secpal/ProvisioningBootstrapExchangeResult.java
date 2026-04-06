/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

final class ProvisioningBootstrapExchangeResult {
    private final String enrollmentSessionId;
    private final int tenantId;
    private final String tenantName;
    private final String apiBaseUrl;
    private final String updateChannel;
    private final String releaseMetadataUrl;
    private final Map<String, Object> provisioningProfile;

    ProvisioningBootstrapExchangeResult(
        String enrollmentSessionId,
        int tenantId,
        String tenantName,
        String apiBaseUrl,
        String updateChannel,
        String releaseMetadataUrl,
        Map<String, Object> provisioningProfile
    ) {
        this.enrollmentSessionId = enrollmentSessionId;
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.apiBaseUrl = apiBaseUrl;
        this.updateChannel = updateChannel;
        this.releaseMetadataUrl = releaseMetadataUrl;
        this.provisioningProfile = Collections.unmodifiableMap(
            new LinkedHashMap<>(provisioningProfile == null ? Collections.emptyMap() : provisioningProfile)
        );
    }

    String getEnrollmentSessionId() {
        return enrollmentSessionId;
    }

    int getTenantId() {
        return tenantId;
    }

    String getTenantName() {
        return tenantName;
    }

    String getApiBaseUrl() {
        return apiBaseUrl;
    }

    String getUpdateChannel() {
        return updateChannel;
    }

    String getReleaseMetadataUrl() {
        return releaseMetadataUrl;
    }

    Map<String, Object> getProvisioningProfile() {
        return provisioningProfile;
    }
}
