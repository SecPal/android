/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Reviewed least-privilege inventory for requests that the packaged Android frontend makes through
 * the bearer-token broker. Authentication, bootstrap, discovery, and health endpoints use their
 * dedicated native flows and deliberately do not appear here.
 */
final class NativeAuthRequestPolicy {
    static final int MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024;
    static final int MAX_RESPONSE_BODY_BYTES = 32 * 1024 * 1024;

    private static final String ID = "[A-Za-z0-9][A-Za-z0-9._~-]*";
    private static final Set<String> NO_QUERY = Collections.emptySet();
    private static final Set<RequestContentKind> NO_CONTENT = Collections.singleton(RequestContentKind.NONE);
    private static final Set<RequestContentKind> JSON_CONTENT = Collections.singleton(RequestContentKind.JSON);
    private static final Set<RequestContentKind> OPTIONAL_JSON_CONTENT = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(RequestContentKind.NONE, RequestContentKind.JSON))
    );
    private static final Set<RequestContentKind> MULTIPART_CONTENT = Collections.singleton(RequestContentKind.MULTIPART);

    private static final List<RouteSpec> ROUTES = buildRoutes();

    private NativeAuthRequestPolicy() {}

    enum ResponseKind {
        JSON
    }

    enum RequestContentKind {
        NONE,
        JSON,
        MULTIPART
    }

    static AuthorizedRequest authorize(
        String method,
        String pathAndQuery,
        String contentType,
        int requestBodyLength
    ) throws NativeAuthHttpException {
        return authorize(method, pathAndQuery, contentType, null, requestBodyLength);
    }

    static AuthorizedRequest authorize(
        String method,
        String pathAndQuery,
        String contentType,
        String accept,
        int requestBodyLength
    ) throws NativeAuthHttpException {
        if (requestBodyLength < 0 || requestBodyLength > MAX_REQUEST_BODY_BYTES) {
            throw validationError("Android auth bridge request exceeds the allowed size");
        }

        String normalizedMethod = NativeAuthHttpClient.normalizeHttpMethod(method);
        CanonicalTarget target = canonicalizeTarget(pathAndQuery);
        RequestContentKind requestContentKind = classifyContentType(contentType);

        if (requestBodyLength > 0 && requestContentKind == RequestContentKind.NONE) {
            throw validationError("Android auth bridge requires an inventoried request content type");
        }

        for (RouteSpec route : ROUTES) {
            if (!route.method.equals(normalizedMethod) || !route.pathPattern.matcher(target.decodedPath).matches()) {
                continue;
            }
            if (!route.allowedQueryKeys.containsAll(target.queryKeys)) {
                throw validationError("Android auth bridge request contains an unsupported query key");
            }
            if (!route.allowedContentKinds.contains(requestContentKind)) {
                throw validationError("Android auth bridge request has an unsupported content type");
            }
            validateAccept(accept, route.responseKind);
            if (requestContentKind == RequestContentKind.MULTIPART && requestBodyLength == 0) {
                throw validationError("Android auth bridge multipart request body is empty");
            }

            return new AuthorizedRequest(
                normalizedMethod,
                target.canonicalPathAndQuery,
                route.responseKind
            );
        }

        throw validationError("Android auth bridge request is not in the mobile route inventory");
    }

    private static List<RouteSpec> buildRoutes() {
        List<RouteSpec> routes = new ArrayList<>();

        add(routes, "GET", "/v1/me", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/auth/email/verification-notification", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/me/mfa", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "DELETE", "/v1/me/mfa", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/me/passkeys", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/me/passkeys/challenges/registration", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/me/passkeys/challenges/registration/" + ID + "/verify", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "DELETE", "/v1/me/passkeys/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/me/mfa/totp/enrollment", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/me/mfa/totp/enrollment/confirm", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/me/mfa/recovery-codes/regenerate", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "PUT", "/v1/me/notification-installations/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "DELETE", "/v1/me/notification-installations/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/addresses/de/streets", keys("name", "postal_code", "locality", "limit"), NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/addresses/de/localities", keys("postal_code", "locality", "limit"), NO_CONTENT, ResponseKind.JSON);

        add(routes, "GET", "/v1/organizational-units", keys("type", "parent_id", "is_active", "is_assignable", "per_page", "page"), OPTIONAL_JSON_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/organizational-units", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/organizational-units/" + ID, NO_QUERY, OPTIONAL_JSON_CONTENT, ResponseKind.JSON);
        add(routes, "PATCH", "/v1/organizational-units/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "DELETE", "/v1/organizational-units/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/organizational-units/" + ID + "/descendants", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/organizational-units/" + ID + "/ancestors", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/organizational-units/" + ID + "/parent", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "DELETE", "/v1/organizational-units/" + ID + "/parent/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);

        add(routes, "GET", "/v1/lookups/legal-entities", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/lookups/legal-entities/" + ID + "/establishments", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/lookups/establishments/" + ID + "/customers", NO_QUERY, NO_CONTENT, ResponseKind.JSON);

        add(routes, "GET", "/v1/customers", keys("search", "is_active", "page", "per_page"), NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/customers", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/customers/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "PATCH", "/v1/customers/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "DELETE", "/v1/customers/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/sites", keys("search", "is_active", "customer_id", "legal_entity_id", "establishment_id", "type", "page", "per_page"), NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/sites", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/sites/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "PATCH", "/v1/sites/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "DELETE", "/v1/sites/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);

        add(routes, "GET", "/v1/customer-establishments", keys("customer_id", "establishment_id", "page", "per_page"), NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/customer-establishments", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "PATCH", "/v1/customer-establishments/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "DELETE", "/v1/customer-establishments/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);

        add(routes, "GET", "/v1/employees", keys("status", "legal_entity_id", "establishment_id", "search", "page", "per_page"), NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/employees", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/employees/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "PATCH", "/v1/employees/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/employees/" + ID + "/activate", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/employees/" + ID + "/terminate", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/employees/" + ID + "/bwr/export", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "PUT", "/v1/employees/" + ID + "/bwr/status", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/employees/" + ID + "/qualifications", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/employees/" + ID + "/documents", NO_QUERY, NO_CONTENT, ResponseKind.JSON);

        add(routes, "GET", "/v1/onboarding/nationalities", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/onboarding/templates", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/onboarding/templates/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/onboarding/submissions", NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/onboarding/submissions", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "PATCH", "/v1/onboarding/submissions/" + ID, NO_QUERY, JSON_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/onboarding/submissions/" + ID + "/files", NO_QUERY, MULTIPART_CONTENT, ResponseKind.JSON);
        add(routes, "DELETE", "/v1/onboarding/submissions/" + ID + "/files/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "POST", "/v1/onboarding-review/employees/" + ID + "/confirm", NO_QUERY, JSON_CONTENT, ResponseKind.JSON);

        add(routes, "GET", "/v1/activity-logs", keys(
            "page", "per_page", "from_date", "to_date", "log_name", "search",
            "organizational_unit_id", "causer_type", "causer_id", "subject_type",
            "subject_id", "include_verification"
        ), NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/activity-logs/" + ID, NO_QUERY, NO_CONTENT, ResponseKind.JSON);
        add(routes, "GET", "/v1/activity-logs/" + ID + "/verify", NO_QUERY, NO_CONTENT, ResponseKind.JSON);

        return Collections.unmodifiableList(routes);
    }

    private static void add(
        List<RouteSpec> routes,
        String method,
        String pathRegex,
        Set<String> allowedQueryKeys,
        Set<RequestContentKind> allowedContentKinds,
        ResponseKind responseKind
    ) {
        routes.add(new RouteSpec(
            method,
            Pattern.compile("^" + pathRegex + "$"),
            allowedQueryKeys,
            allowedContentKinds,
            responseKind
        ));
    }

    private static Set<String> keys(String... keys) {
        return Collections.unmodifiableSet(new HashSet<>(Arrays.asList(keys)));
    }

    private static RequestContentKind classifyContentType(String contentType) throws NativeAuthHttpException {
        if (contentType == null || contentType.trim().isEmpty()) {
            return RequestContentKind.NONE;
        }

        String mediaType = contentType.split(";", 2)[0].trim().toLowerCase(Locale.US);
        if ("application/json".equals(mediaType)) {
            return RequestContentKind.JSON;
        }
        if ("multipart/form-data".equals(mediaType)) {
            if (!contentType.toLowerCase(Locale.US).contains("boundary=")) {
                throw validationError("Android auth bridge multipart request requires a boundary");
            }
            return RequestContentKind.MULTIPART;
        }

        throw validationError("Android auth bridge request has an unsupported content type");
    }

    private static void validateAccept(String accept, ResponseKind responseKind)
        throws NativeAuthHttpException {
        if (accept == null || accept.trim().isEmpty()) {
            return;
        }

        String mediaType = accept.trim().toLowerCase(Locale.US);
        if (responseKind == ResponseKind.JSON
            && ("*/*".equals(mediaType) || "application/json".equals(mediaType))) {
            return;
        }
        throw validationError("Android auth bridge request has an unsupported accept type");
    }

    private static CanonicalTarget canonicalizeTarget(String target) throws NativeAuthHttpException {
        if (target == null || target.isEmpty() || !target.equals(target.trim())) {
            throw validationError("Android auth bridge requires a canonical request target");
        }
        if (!target.startsWith("/") || target.startsWith("//") || target.indexOf('\\') >= 0) {
            throw validationError("Android auth bridge requires an unambiguous relative request target");
        }

        URI uri;
        try {
            uri = new URI(target);
        } catch (URISyntaxException exception) {
            throw validationError("Android auth bridge request target is invalid");
        }

        if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getRawFragment() != null) {
            throw validationError("Android auth bridge request target must contain only path and query components");
        }

        String rawPath = uri.getRawPath();
        if (rawPath == null || !rawPath.startsWith("/") || rawPath.startsWith("//")) {
            throw validationError("Android auth bridge requires a canonical relative path");
        }

        String[] rawSegments = rawPath.substring(1).split("/", -1);
        StringBuilder decodedPath = new StringBuilder();
        StringBuilder canonicalPath = new StringBuilder();
        for (String rawSegment : rawSegments) {
            String decodedSegment = decodeComponent(rawSegment);
            if (decodedSegment.isEmpty()
                || ".".equals(decodedSegment)
                || "..".equals(decodedSegment)
                || decodedSegment.indexOf('/') >= 0
                || decodedSegment.indexOf('\\') >= 0
                || decodedSegment.indexOf('%') >= 0
                || containsControlCharacter(decodedSegment)) {
                throw validationError("Android auth bridge request path is ambiguous");
            }
            decodedPath.append('/').append(decodedSegment);
            canonicalPath.append('/').append(encodeComponent(decodedSegment));
        }

        List<QueryPair> queryPairs = parseQuery(uri.getRawQuery());
        queryPairs.sort(Comparator.comparing(QueryPair::getKey));
        StringBuilder canonicalTarget = new StringBuilder(canonicalPath);
        if (!queryPairs.isEmpty()) {
            canonicalTarget.append('?');
            for (int index = 0; index < queryPairs.size(); index++) {
                if (index > 0) {
                    canonicalTarget.append('&');
                }
                QueryPair pair = queryPairs.get(index);
                canonicalTarget
                    .append(encodeComponent(pair.key))
                    .append('=')
                    .append(encodeComponent(pair.value));
            }
        }

        Set<String> queryKeys = new HashSet<>();
        for (QueryPair pair : queryPairs) {
            queryKeys.add(pair.key);
        }
        return new CanonicalTarget(decodedPath.toString(), canonicalTarget.toString(), queryKeys);
    }

    private static List<QueryPair> parseQuery(String rawQuery) throws NativeAuthHttpException {
        if (rawQuery == null) {
            return new ArrayList<>();
        }
        if (rawQuery.isEmpty()) {
            throw validationError("Android auth bridge request query is empty");
        }

        List<QueryPair> pairs = new ArrayList<>();
        Set<String> seenKeys = new HashSet<>();
        for (String rawPair : rawQuery.split("&", -1)) {
            int equalsIndex = rawPair.indexOf('=');
            if (equalsIndex <= 0) {
                throw validationError("Android auth bridge request query is ambiguous");
            }
            String key = decodeComponent(rawPair.substring(0, equalsIndex).replace("+", "%20"));
            String value = decodeComponent(rawPair.substring(equalsIndex + 1).replace("+", "%20"));
            if (key.isEmpty()
                || key.indexOf('%') >= 0
                || value.indexOf('%') >= 0
                || containsControlCharacter(key)
                || containsControlCharacter(value)
                || !seenKeys.add(key)) {
                throw validationError("Android auth bridge request query is ambiguous");
            }
            pairs.add(new QueryPair(key, value));
        }
        return pairs;
    }

    private static String decodeComponent(String raw) throws NativeAuthHttpException {
        StringBuilder decoded = new StringBuilder();
        for (int index = 0; index < raw.length();) {
            char character = raw.charAt(index);
            if (character != '%') {
                decoded.append(character);
                index += 1;
                continue;
            }

            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            while (index < raw.length() && raw.charAt(index) == '%') {
                if (index + 2 >= raw.length()) {
                    throw validationError("Android auth bridge request contains invalid percent encoding");
                }
                int high = Character.digit(raw.charAt(index + 1), 16);
                int low = Character.digit(raw.charAt(index + 2), 16);
                if (high < 0 || low < 0) {
                    throw validationError("Android auth bridge request contains invalid percent encoding");
                }
                bytes.write((high << 4) + low);
                index += 3;
            }

            try {
                CharBuffer chars = StandardCharsets.UTF_8
                    .newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes.toByteArray()));
                decoded.append(chars);
            } catch (CharacterCodingException exception) {
                throw validationError("Android auth bridge request contains invalid UTF-8 encoding");
            }
        }
        return decoded.toString();
    }

    private static String encodeComponent(String value) {
        StringBuilder encoded = new StringBuilder();
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        for (byte valueByte : bytes) {
            int unsigned = valueByte & 0xff;
            if ((unsigned >= 'a' && unsigned <= 'z')
                || (unsigned >= 'A' && unsigned <= 'Z')
                || (unsigned >= '0' && unsigned <= '9')
                || unsigned == '-'
                || unsigned == '.'
                || unsigned == '_'
                || unsigned == '~') {
                encoded.append((char) unsigned);
            } else {
                encoded.append('%');
                encoded.append(Character.toUpperCase(Character.forDigit((unsigned >>> 4) & 0xf, 16)));
                encoded.append(Character.toUpperCase(Character.forDigit(unsigned & 0xf, 16)));
            }
        }
        return encoded.toString();
    }

    private static boolean containsControlCharacter(String value) {
        for (int index = 0; index < value.length(); index++) {
            if (Character.isISOControl(value.charAt(index))) {
                return true;
            }
        }
        return false;
    }

    private static NativeAuthHttpException validationError(String message) {
        return new NativeAuthHttpException(message, 0);
    }

    static final class AuthorizedRequest {
        private final String method;
        private final String canonicalPathAndQuery;
        private final ResponseKind responseKind;

        AuthorizedRequest(String method, String canonicalPathAndQuery, ResponseKind responseKind) {
            this.method = method;
            this.canonicalPathAndQuery = canonicalPathAndQuery;
            this.responseKind = responseKind;
        }

        String getMethod() { return method; }
        String getCanonicalPathAndQuery() { return canonicalPathAndQuery; }
        ResponseKind getResponseKind() { return responseKind; }
    }

    private static final class RouteSpec {
        private final String method;
        private final Pattern pathPattern;
        private final Set<String> allowedQueryKeys;
        private final Set<RequestContentKind> allowedContentKinds;
        private final ResponseKind responseKind;

        RouteSpec(
            String method,
            Pattern pathPattern,
            Set<String> allowedQueryKeys,
            Set<RequestContentKind> allowedContentKinds,
            ResponseKind responseKind
        ) {
            this.method = method;
            this.pathPattern = pathPattern;
            this.allowedQueryKeys = allowedQueryKeys;
            this.allowedContentKinds = allowedContentKinds;
            this.responseKind = responseKind;
        }
    }

    private static final class CanonicalTarget {
        private final String decodedPath;
        private final String canonicalPathAndQuery;
        private final Set<String> queryKeys;

        CanonicalTarget(String decodedPath, String canonicalPathAndQuery, Set<String> queryKeys) {
            this.decodedPath = decodedPath;
            this.canonicalPathAndQuery = canonicalPathAndQuery;
            this.queryKeys = queryKeys;
        }
    }

    private static final class QueryPair {
        private final String key;
        private final String value;

        QueryPair(String key, String value) {
            this.key = key;
            this.value = value;
        }

        String getKey() { return key; }
    }
}
