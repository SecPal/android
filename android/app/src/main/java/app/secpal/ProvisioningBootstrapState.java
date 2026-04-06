/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

final class ProvisioningBootstrapState {
    static final String STATUS_NONE = "none";
    static final String STATUS_PENDING = "pending";
    static final String STATUS_COMPLETED = "completed";
    static final String STATUS_FAILED = "failed";

    private final String status;
    private final String enrollmentSessionId;
    private final String updateChannel;
    private final String releaseMetadataUrl;
    private final String apiBaseUrl;
    private final String tenantName;
    private final int tenantId;
    private final String lastErrorCode;

    ProvisioningBootstrapState(
        String status,
        String enrollmentSessionId,
        String updateChannel,
        String releaseMetadataUrl,
        String apiBaseUrl,
        String tenantName,
        int tenantId,
        String lastErrorCode
    ) {
        this.status = status;
        this.enrollmentSessionId = enrollmentSessionId;
        this.updateChannel = updateChannel;
        this.releaseMetadataUrl = releaseMetadataUrl;
        this.apiBaseUrl = apiBaseUrl;
        this.tenantName = tenantName;
        this.tenantId = tenantId;
        this.lastErrorCode = lastErrorCode;
    }

    String getStatus() {
        return status;
    }

    boolean isPending() {
        return STATUS_PENDING.equals(status);
    }

    String getEnrollmentSessionId() {
        return enrollmentSessionId;
    }

    String getUpdateChannel() {
        return updateChannel;
    }

    String getReleaseMetadataUrl() {
        return releaseMetadataUrl;
    }

    String getApiBaseUrl() {
        return apiBaseUrl;
    }

    String getTenantName() {
        return tenantName;
    }

    int getTenantId() {
        return tenantId;
    }

    String getLastErrorCode() {
        return lastErrorCode;
    }
}
