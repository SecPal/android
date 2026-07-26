/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

const fail = (message) => {
  throw new Error(message);
};

const readRequiredFile = (path, description) => {
  try {
    if (!statSync(path).isFile()) {
      fail(`${description} is not a file: ${path}`);
    }
  } catch {
    fail(`${description} is missing: ${path}`);
  }

  return readFileSync(path, "utf8");
};

const findFiles = (root) => {
  try {
    if (!statSync(root).isDirectory()) {
      fail(`Merged release resource root is not a directory: ${root}`);
    }
  } catch {
    fail(`Merged release resource root is missing: ${root}`);
  }

  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  };

  visit(root);
  return files;
};

const stripXmlComments = (xml) => {
  let stripped = xml;

  while (true) {
    const commentStart = stripped.indexOf("<!--");
    if (commentStart === -1) {
      return stripped;
    }

    const commentEnd = stripped.indexOf("-->", commentStart + 4);
    if (commentEnd === -1) {
      fail("XML contains an unterminated XML comment");
    }

    stripped = stripped.slice(0, commentStart) + stripped.slice(commentEnd + 3);
  }
};

const readAndroidAttribute = (xml, name) => {
  const matches = Array.from(
    xml.matchAll(
      new RegExp(`\\bandroid:${name}\\s*=\\s*["']([^"']+)["']`, "g")
    ),
    (match) => match[1]
  );

  if (matches.length !== 1) {
    fail(
      `Merged release manifest must define android:${name} exactly once; found ${matches.length}`
    );
  }

  return matches[0];
};

const verifyManifest = (manifestPath) => {
  const manifest = stripXmlComments(
    readRequiredFile(manifestPath, "Merged release manifest")
  );
  const networkSecurityConfig = readAndroidAttribute(
    manifest,
    "networkSecurityConfig"
  );
  const usesCleartextTraffic = readAndroidAttribute(
    manifest,
    "usesCleartextTraffic"
  );

  if (networkSecurityConfig !== "@xml/network_security_config") {
    fail(
      `Merged release manifest must reference @xml/network_security_config; found ${networkSecurityConfig}`
    );
  }
  if (usesCleartextTraffic !== "false") {
    fail(
      `Merged release manifest must disable cleartext traffic; found ${usesCleartextTraffic}`
    );
  }
};

const verifyCertificateSources = (xml, path) => {
  const certificateTags = Array.from(xml.matchAll(/<certificates\b([^>]*)>/g));
  if (certificateTags.length === 0) {
    fail(`Network Security Configuration has no trust anchors: ${path}`);
  }

  for (const [, attributes] of certificateTags) {
    const sources = Array.from(
      attributes.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/g),
      (match) => match[1]
    );
    if (sources.length !== 1 || sources[0] !== "system") {
      fail(
        `Network Security Configuration contains a non-system trust source in ${path}`
      );
    }
  }
};

const readResourceApiLevel = (resourcesRoot, path) => {
  const directorySegments = relative(resourcesRoot, path)
    .split(sep)
    .slice(0, -1);
  const xmlDirectory = directorySegments.find((segment) =>
    /^xml(?:-.+)?$/.test(segment)
  );
  if (!xmlDirectory) {
    fail(
      `Network Security Configuration is outside an XML resource directory: ${path}`
    );
  }

  const apiQualifiers = Array.from(
    xmlDirectory.matchAll(/(?:^|-)v([0-9]+)(?=-|$)/g),
    (match) => Number.parseInt(match[1], 10)
  );
  if (apiQualifiers.length > 1) {
    fail(`Network Security Configuration has multiple API qualifiers: ${path}`);
  }

  return apiQualifiers[0] ?? null;
};

const verifyApi36CertificateTransparency = (xml, path, apiLevel) => {
  const certificateTransparencyTags = Array.from(
    xml.matchAll(/<certificateTransparency\b([^>]*)\/?>/g)
  );

  if (
    certificateTransparencyTags.length > 0 &&
    (apiLevel === null || apiLevel < 36)
  ) {
    fail(
      `Network Security Configuration exposes certificateTransparency below API 36: ${path}`
    );
  }

  if (apiLevel === null || apiLevel < 36) {
    return;
  }

  const baseConfig =
    xml.match(/<base-config\b[^>]*>([\s\S]*?)<\/base-config>/)?.[1] ?? "";
  const readCtValues = (contents) =>
    Array.from(
      contents.matchAll(
        /<certificateTransparency\b[^>]*\benabled\s*=\s*["']([^"']+)["'][^>]*\/?>/g
      ),
      (match) => match[1]
    );

  const hasGlobalCtPolicy =
    certificateTransparencyTags.length === 1 &&
    readCtValues(baseConfig).join(",") === "true";

  if (!hasGlobalCtPolicy) {
    fail(
      `API 36 Network Security Configuration must enforce certificate transparency globally: ${path}`
    );
  }
};

const verifyApi37LocalhostHardening = (xml, path, apiLevel) => {
  if (apiLevel !== 37) {
    return;
  }

  const explicitlyConfiguredLocalhost = Array.from(
    xml.matchAll(/<domain\b[^>]*>\s*localhost\s*<\/domain>/g)
  );
  if (explicitlyConfiguredLocalhost.length !== 1) {
    fail(
      `API 37 Network Security Configuration must explicitly configure localhost exactly once to disable Android's implicit cleartext exception: ${path}`
    );
  }
};

const verifyNetworkSecurityConfig = (resourcesRoot, path) => {
  const xml = stripXmlComments(
    readRequiredFile(path, "Merged Network Security Configuration")
  );
  const apiLevel = readResourceApiLevel(resourcesRoot, path);

  if (/\bcleartextTrafficPermitted\s*=\s*["']true["']/.test(xml)) {
    fail(`Network Security Configuration permits cleartext traffic: ${path}`);
  }
  if (
    !/<base-config\b[^>]*\bcleartextTrafficPermitted\s*=\s*["']false["']/.test(
      xml
    )
  ) {
    fail(
      `Network Security Configuration does not disable cleartext traffic in its base policy: ${path}`
    );
  }
  if (/<pin-set(?:\s|\/?>)/.test(xml) || /<pin(?:\s|\/?>)/.test(xml)) {
    fail(
      `Network Security Configuration contains certificate pinning: ${path}`
    );
  }
  if (/\boverridePins\s*=\s*["']true["']/.test(xml)) {
    fail(`Network Security Configuration overrides pin validation: ${path}`);
  }
  if (/<debug-overrides(?:\s|>)/.test(xml)) {
    fail(
      `Network Security Configuration contains debug trust overrides: ${path}`
    );
  }

  verifyCertificateSources(xml, path);
  verifyApi36CertificateTransparency(xml, path, apiLevel);
  verifyApi37LocalhostHardening(xml, path, apiLevel);
};

const isNetworkSecurityConfig = (root, path) => {
  if (basename(path) !== "network_security_config.xml") {
    return false;
  }

  return relative(root, path)
    .split(sep)
    .slice(0, -1)
    .some((segment) => /^xml(?:-.+)?$/.test(segment));
};

const verifyResources = (resourcesRoot) => {
  const files = findFiles(resourcesRoot);
  const aliases = files.filter((path) => {
    if (!path.endsWith(".xml")) {
      return false;
    }

    const xml = stripXmlComments(readFileSync(path, "utf8"));
    return (
      /<item\b(?=[^>]*\btype\s*=\s*["']xml["'])(?=[^>]*\bname\s*=\s*["']network_security_config["'])[^>]*>/.test(
        xml
      ) ||
      /<item\b(?=[^>]*\bname\s*=\s*["']network_security_config["'])(?=[^>]*\btype\s*=\s*["']xml["'])[^>]*>/.test(
        xml
      )
    );
  });
  if (aliases.length > 0) {
    fail(
      `Merged release resources must not alias network_security_config: ${aliases.join(", ")}`
    );
  }

  const configurations = files.filter((path) =>
    isNetworkSecurityConfig(resourcesRoot, path)
  );
  if (configurations.length === 0) {
    fail(
      `Merged release resources contain no network_security_config.xml under ${resourcesRoot}`
    );
  }

  const api36Configurations = configurations.filter(
    (path) => readResourceApiLevel(resourcesRoot, path) === 36
  );
  if (api36Configurations.length !== 1) {
    fail(
      `Merged release resources must define an API 36 network security policy exactly once; found ${api36Configurations.length}`
    );
  }

  const api37Configurations = configurations.filter(
    (path) => readResourceApiLevel(resourcesRoot, path) === 37
  );
  if (api37Configurations.length !== 1) {
    fail(
      `Merged release resources must define an API 37 localhost hardening policy exactly once; found ${api37Configurations.length}`
    );
  }

  for (const configuration of configurations) {
    verifyNetworkSecurityConfig(resourcesRoot, configuration);
  }
};

const [manifestPath, resourcesRoot] = process.argv.slice(2);
if (!manifestPath || !resourcesRoot || process.argv.length !== 4) {
  console.error(
    "Usage: node scripts/verify-android-network-security.mjs MERGED_MANIFEST MERGED_RESOURCES"
  );
  process.exit(2);
}

try {
  verifyManifest(manifestPath);
  verifyResources(resourcesRoot);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `Android release network security verification failed: ${message}`
  );
  process.exit(1);
}
