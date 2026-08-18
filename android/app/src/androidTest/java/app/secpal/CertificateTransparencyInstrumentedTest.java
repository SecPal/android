/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.security.NetworkSecurityPolicy;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.net.URL;

import javax.net.ssl.HttpsURLConnection;

@RunWith(AndroidJUnit4.class)
public final class CertificateTransparencyInstrumentedTest {
    private static final String API_HOST = "api.secpal.dev";
    private static final String CUSTOMER_API_HOST = "customer-api.example";
    private static final String LIVE_PROBE_ARGUMENT = "secpalLiveCtProbe";
    private static final String LIVE_PROBE_URL_ARGUMENT = "secpalLiveCtProbeUrl";
    private static final String DEFAULT_LIVE_PROBE_URL = "https://api.secpal.dev/";

    @Test
    @SdkSuppress(maxSdkVersion = 35)
    public void fallbackPolicyLoadsAndProhibitsCleartextBelowApi36() {
        NetworkSecurityPolicy policy = NetworkSecurityPolicy.getInstance();

        assertFalse(policy.isCleartextTrafficPermitted());
        assertFalse(policy.isCleartextTrafficPermitted(API_HOST));
    }

    @Test
    @SdkSuppress(minSdkVersion = 36)
    public void api36PolicyRequiresCertificateTransparencyForAllHosts() {
        NetworkSecurityPolicy policy = NetworkSecurityPolicy.getInstance();

        assertTrue(policy.isCertificateTransparencyVerificationRequired(API_HOST));
        assertTrue(
            policy.isCertificateTransparencyVerificationRequired(CUSTOMER_API_HOST)
        );
        assertTrue(
            policy.isCertificateTransparencyVerificationRequired("app.secpal.dev")
        );
    }

    @Test
    @SdkSuppress(minSdkVersion = 37)
    public void api37PolicyDoesNotPermitTheImplicitLocalhostCleartextException() {
        NetworkSecurityPolicy policy = NetworkSecurityPolicy.getInstance();

        assertFalse(policy.isCleartextTrafficPermitted("localhost"));
        assertFalse(policy.isCleartextTrafficPermitted("127.0.0.1"));
        assertFalse(policy.isCleartextTrafficPermitted("::1"));
        assertTrue(policy.isCertificateTransparencyVerificationRequired("localhost"));
        assertTrue(policy.isCertificateTransparencyVerificationRequired("127.0.0.1"));
        assertTrue(policy.isCertificateTransparencyVerificationRequired("::1"));
    }

    @Test
    @SdkSuppress(minSdkVersion = 36)
    public void apiEndpointPassesThePlatformCertificateTransparencyPolicy()
        throws Exception {
        Assume.assumeTrue(
            "Live CT probe was not requested",
            "true".equals(
                InstrumentationRegistry.getArguments().getString(LIVE_PROBE_ARGUMENT)
            )
        );
        assertTrue(
            NetworkSecurityPolicy.getInstance()
                .isCertificateTransparencyVerificationRequired(API_HOST)
        );

        URL liveProbeUrl = new URL(
            InstrumentationRegistry.getArguments().getString(
                LIVE_PROBE_URL_ARGUMENT,
                DEFAULT_LIVE_PROBE_URL
            )
        );
        assertEquals("Live CT probes must use HTTPS", "https", liveProbeUrl.getProtocol());
        assertTrue(
            "Live CT probes require a hostname",
            liveProbeUrl.getHost() != null && !liveProbeUrl.getHost().trim().isEmpty()
        );
        assertNull("Live CT probes must not contain user information", liveProbeUrl.getUserInfo());
        assertTrue(
            NetworkSecurityPolicy.getInstance()
                .isCertificateTransparencyVerificationRequired(liveProbeUrl.getHost())
        );

        HttpsURLConnection connection = (HttpsURLConnection) liveProbeUrl.openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(15_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("HEAD");

        try {
            int responseCode = connection.getResponseCode();
            assertTrue(
                "Expected an HTTP response after the CT-validated TLS handshake",
                responseCode >= 100 && responseCode <= 599
            );
        } finally {
            connection.disconnect();
        }
    }
}
