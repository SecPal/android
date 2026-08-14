/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import org.junit.Test;

public class NativeAuthRequestPolicyTest {

    @Test
    public void rejectsRequestTargetsBeyondThePreAdmissionMemoryBound() {
        String oversizedTarget = "/v1/customers?cursor=" + "a".repeat(
            NativeAuthRequestPolicy.MAX_REQUEST_TARGET_CHARACTERS
        );

        assertRejected(
            "GET",
            oversizedTarget,
            null,
            0
        );
    }

    @Test
    public void rejectsOversizedMediaMetadataBeforeParsing() {
        assertHeaderRejected(
            "application/json;" + "x".repeat(
                NativeAuthRequestPolicy.MAX_MEDIA_TYPE_CHARACTERS
            ),
            "application/json"
        );
    }

    @Test
    public void rejectsOversizedMethodsBeforeNormalization() {
        assertRejected(
            "G".repeat(NativeAuthRequestPolicy.MAX_METHOD_CHARACTERS + 1),
            "/v1/me",
            null,
            0
        );
    }

    @Test
    public void allowsRepresentativeInventoriedFrontendRequests() throws Exception {
        assertAuthorized(
            "GET",
            "/v1/customers?search=Acme&page=2&per_page=25",
            null,
            0,
            NativeAuthRequestPolicy.ResponseKind.JSON
        );
        assertAuthorized(
            "PUT",
            "/v1/me/notification-installations/7cb38f42-8d47-44f6-8d1f-12ff7c24fe38",
            "application/json; charset=UTF-8",
            128,
            NativeAuthRequestPolicy.ResponseKind.JSON
        );
        assertAuthorized(
            "POST",
            "/v1/onboarding-review/employees/employee-7/confirm",
            "application/json",
            64,
            NativeAuthRequestPolicy.ResponseKind.JSON
        );
    }

    @Test
    public void completeReviewedFrontendInventoryRemainsAuthorized() throws Exception {
        Object[][] requests = {
            { "GET", "/v1/me", null, 0 },
            { "POST", "/v1/auth/email/verification-notification", null, 0 },
            { "GET", "/v1/me/mfa", null, 0 },
            { "DELETE", "/v1/me/mfa", "application/json", 2 },
            { "GET", "/v1/me/passkeys", null, 0 },
            { "POST", "/v1/me/passkeys/challenges/registration", "application/json", 2 },
            { "POST", "/v1/me/passkeys/challenges/registration/challenge-1/verify", "application/json", 2 },
            { "DELETE", "/v1/me/passkeys/credential-1", "application/json", 2 },
            { "POST", "/v1/me/mfa/totp/enrollment", null, 0 },
            { "POST", "/v1/me/mfa/totp/enrollment/confirm", "application/json", 2 },
            { "POST", "/v1/me/mfa/recovery-codes/regenerate", "application/json", 2 },
            { "PUT", "/v1/me/notification-installations/device-1", "application/json", 2 },
            { "DELETE", "/v1/me/notification-installations/device-1", null, 0 },
            { "GET", "/v1/addresses/de/streets?name=Main&postal_code=10115&locality=Berlin&limit=10", null, 0 },
            { "GET", "/v1/addresses/de/localities?postal_code=10115&locality=Berlin&limit=10", null, 0 },
            { "GET", "/v1/organizational-units?type=branch&parent_id=null&is_active=1&is_assignable=1&per_page=25&page=1", "application/json", 0 },
            { "POST", "/v1/organizational-units", "application/json", 2 },
            { "GET", "/v1/organizational-units/unit-1", "application/json", 0 },
            { "PATCH", "/v1/organizational-units/unit-1", "application/json", 2 },
            { "DELETE", "/v1/organizational-units/unit-1", "application/json", 0 },
            { "POST", "/v1/organizational-units/unit-1/parent", "application/json", 2 },
            { "DELETE", "/v1/organizational-units/unit-1/parent/unit-2", "application/json", 0 },
            { "GET", "/v1/lookups/legal-entities", null, 0 },
            { "GET", "/v1/lookups/legal-entities/entity-1/establishments", null, 0 },
            { "GET", "/v1/lookups/establishments/establishment-1/customers", null, 0 },
            { "GET", "/v1/customers?search=Acme&is_active=1&page=1&per_page=25", null, 0 },
            { "POST", "/v1/customers", "application/json", 2 },
            { "GET", "/v1/customers/customer-1", null, 0 },
            { "PATCH", "/v1/customers/customer-1", "application/json", 2 },
            { "DELETE", "/v1/customers/customer-1", null, 0 },
            { "GET", "/v1/sites?search=North&is_active=1&customer_id=1&legal_entity_id=entity-1&establishment_id=establishment-1&type=branch&page=1&per_page=25", null, 0 },
            { "POST", "/v1/sites", "application/json", 2 },
            { "GET", "/v1/sites/site-1", null, 0 },
            { "PATCH", "/v1/sites/site-1", "application/json", 2 },
            { "DELETE", "/v1/sites/site-1", null, 0 },
            { "GET", "/v1/customer-establishments?customer_id=customer-1&establishment_id=establishment-1&page=1&per_page=25", null, 0 },
            { "POST", "/v1/customer-establishments", "application/json", 2 },
            { "PATCH", "/v1/customer-establishments/link-1", "application/json", 2 },
            { "DELETE", "/v1/customer-establishments/link-1", null, 0 },
            { "GET", "/v1/employees?status=active&legal_entity_id=entity-1&establishment_id=establishment-1&search=Jane&page=1&per_page=25", null, 0 },
            { "POST", "/v1/employees", "application/json", 2 },
            { "GET", "/v1/employees/employee-1", null, 0 },
            { "PATCH", "/v1/employees/employee-1", "application/json", 2 },
            { "POST", "/v1/employees/employee-1/activate", null, 0 },
            { "POST", "/v1/employees/employee-1/terminate", null, 0 },
            { "POST", "/v1/employees/employee-1/bwr/export", "application/json", 2 },
            { "PUT", "/v1/employees/employee-1/bwr/status", "application/json", 2 },
            { "GET", "/v1/employees/employee-1/qualifications", null, 0 },
            { "GET", "/v1/employees/employee-1/documents", null, 0 },
            { "GET", "/v1/onboarding/nationalities", null, 0 },
            { "GET", "/v1/onboarding/templates", null, 0 },
            { "GET", "/v1/onboarding/templates/template-1", null, 0 },
            { "GET", "/v1/onboarding/submissions", null, 0 },
            { "POST", "/v1/onboarding/submissions", "application/json", 2 },
            { "PATCH", "/v1/onboarding/submissions/submission-1", "application/json", 2 },
            { "POST", "/v1/onboarding/submissions/submission-1/files", "multipart/form-data; boundary=x", 16 },
            { "DELETE", "/v1/onboarding/submissions/submission-1/files/file-1", null, 0 },
            { "POST", "/v1/onboarding-review/employees/employee-1/confirm", "application/json", 2 },
            { "GET", "/v1/activity-logs?page=1&per_page=25&from_date=2026-01-01&to_date=2026-01-31&log_name=default&search=updated&organizational_unit_id=unit-1&causer_type=user&causer_id=user-1&subject_type=employee&subject_id=employee-1&include_verification=1", null, 0 },
            { "GET", "/v1/activity-logs/activity-1/verify", null, 0 },
        };

        for (Object[] request : requests) {
            NativeAuthRequestPolicy.authorize(
                (String) request[0],
                (String) request[1],
                (String) request[2],
                (Integer) request[3]
            );
        }
    }

    @Test
    public void rejectsCredentialBootstrapAndUnknownEndpoints() {
        assertRejected("POST", "/v1/auth/token", "application/json", 2);
        assertRejected("GET", "/v1/bootstrap?client_platform=android", null, 0);
        assertRejected("GET", "/v1/not-in-the-mobile-inventory", null, 0);
    }

    @Test
    public void rejectsRoutesWithoutACallerInThePackagedAndroidFrontend() {
        Object[][] requests = {
            { "PATCH", "/v1/me/language", "application/json", 2 },
            { "GET", "/v1/me/organizational-scopes", "application/json", 0 },
            { "POST", "/v1/qualifications", "application/json", 2 },
            { "POST", "/v1/employees/employee-1/qualifications", "application/json", 2 },
            { "POST", "/v1/sites/site-1/cost-centers", "application/json", 2 },
            { "POST", "/v1/customers/customer-1/assignments", "application/json", 2 },
            { "POST", "/v1/employees/employee-1/documents", "multipart/form-data; boundary=x", 16 },
            { "GET", "/v1/onboarding/steps", null, 0 },
            { "POST", "/v1/onboarding-review/submissions/submission-1/approve", null, 0 },
            { "GET", "/v1/android-enrollment-sessions?per_page=15", null, 0 },
            { "POST", "/v1/android-enrollment-sessions", "application/json", 2 },
            { "POST", "/v1/android-enrollment-sessions/session-1/revoke", "application/json", 2 },
            { "GET", "/v1/activity-logs/activity-1", null, 0 },
            { "GET", "/v1/organizational-units/unit-1/ancestors", "application/json", 0 },
            { "GET", "/v1/organizational-units/unit-1/descendants", "application/json", 0 },
        };

        for (Object[] request : requests) {
            assertRejected(
                (String) request[0],
                (String) request[1],
                (String) request[2],
                (Integer) request[3]
            );
        }
    }

    @Test
    public void rejectsMethodQueryAndContentTypeOutsideMatchedContract() {
        assertRejected("DELETE", "/v1/customers", null, 0);
        assertRejected("GET", "/v1/customers?admin=1", null, 0);
        assertRejected("GET", "/v1/customers?page=1&page=2", null, 0);
        assertRejected("POST", "/v1/customers", "text/plain", 2);
        assertRejected("GET", "/v1/customers", "application/json", 0);
        assertAcceptRejected("GET", "/v1/customers", "text/html");
    }

    @Test
    public void rejectsAmbiguousAndMultiplyEncodedPaths() {
        String[] paths = {
            "/v1/../auth/token",
            "/v1/%2e%2e/auth/token",
            "/v1/%252e%252e/auth/token",
            "//example/v1/me",
            "/\\\\example",
            "/v1/me#fragment",
            "/v1/customers/%2Froles",
            "/v1/customers/%5croles",
            "/v1/customers/%C3%28",
            "/v1/customers?search=%ZZ",
        };

        for (String path : paths) {
            assertRejected("GET", path, null, 0);
        }
    }

    @Test
    public void canonicalizesPercentHexAndQueryOrderingOnce() throws Exception {
        NativeAuthRequestPolicy.AuthorizedRequest request = NativeAuthRequestPolicy.authorize(
            "GET",
            "/v1/customers?per_page=25&search=North%20Site&page=1",
            null,
            0
        );

        assertEquals(
            "/v1/customers?page=1&per_page=25&search=North%20Site",
            request.getCanonicalPathAndQuery()
        );
    }

    @Test
    public void canonicalizesValidatedRequestHeaders() throws Exception {
        NativeAuthRequestPolicy.AuthorizedRequest jsonRequest =
            NativeAuthRequestPolicy.authorize(
                "POST",
                "/v1/customers",
                " application/json; charset=UTF-8 ",
                " */* ",
                2
            );
        NativeAuthRequestPolicy.AuthorizedRequest multipartRequest =
            NativeAuthRequestPolicy.authorize(
                "POST",
                "/v1/onboarding/submissions/submission-1/files",
                "multipart/form-data; boundary=----WebKitFormBoundary123",
                "application/json",
                10
            );

        assertEquals("application/json", jsonRequest.getContentType());
        assertEquals("application/json", jsonRequest.getAccept());
        assertEquals(
            "multipart/form-data; boundary=----WebKitFormBoundary123",
            multipartRequest.getContentType()
        );
        assertEquals("application/json", multipartRequest.getAccept());
    }

    @Test
    public void rejectsControlCharactersAndUnsupportedHeaderParameters() {
        assertHeaderRejected(
            "application/json;\r\nX-Test: value",
            "application/json"
        );
        assertHeaderRejected(
            "application/json",
            "application/json\nX-Test: value"
        );
        assertHeaderRejected(
            "application/json; profile=admin",
            "application/json"
        );
        assertHeaderRejected(
            "multipart/form-data; boundary=valid; injected=value",
            "application/json"
        );
    }

    @Test
    public void rejectsOversizedIndividualRequestBeforeAuthorization() {
        assertRejected(
            "POST",
            "/v1/customers",
            "application/json",
            NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES + 1
        );
    }

    @Test
    public void rejectsBodiesForMethodsThatMustNotCarryRequestContent() {
        assertRejected("GET", "/v1/organizational-units", "application/json", 2);
    }

    private static void assertAuthorized(
        String method,
        String path,
        String contentType,
        int bodyLength,
        NativeAuthRequestPolicy.ResponseKind responseKind
    ) throws Exception {
        NativeAuthRequestPolicy.AuthorizedRequest request = NativeAuthRequestPolicy.authorize(
            method,
            path,
            contentType,
            bodyLength
        );

        assertEquals(method, request.getMethod());
        assertEquals(responseKind, request.getResponseKind());
    }

    private static void assertRejected(
        String method,
        String path,
        String contentType,
        int bodyLength
    ) {
        try {
            NativeAuthRequestPolicy.authorize(method, path, contentType, bodyLength);
            fail("Expected native authenticated request to be rejected: " + method + " " + path);
        } catch (NativeAuthHttpException expected) {
            // Expected fail-closed policy decision.
        }
    }

    private static void assertAcceptRejected(String method, String path, String accept) {
        try {
            NativeAuthRequestPolicy.authorize(method, path, null, accept, 0);
            fail("Expected native authenticated request Accept header to be rejected");
        } catch (NativeAuthHttpException expected) {
            // Expected fail-closed policy decision.
        }
    }

    private static void assertHeaderRejected(String contentType, String accept) {
        try {
            NativeAuthRequestPolicy.authorize(
                "POST",
                "/v1/customers",
                contentType,
                accept,
                2
            );
            fail("Expected native authenticated request header to be rejected");
        } catch (NativeAuthHttpException expected) {
            // Expected fail-closed policy decision.
        }
    }
}
