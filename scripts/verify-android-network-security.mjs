/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

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

const parseXml = (xml, path) => {
  const diagnostics = [];
  let document;
  try {
    document = new DOMParser({
      onError: (_level, message) => diagnostics.push(message),
    }).parseFromString(xml, "application/xml");
  } catch (error) {
    if (diagnostics.length === 0) {
      throw error;
    }
  }

  if (!document || diagnostics.length > 0) {
    fail(
      `XML is malformed in ${path}: ${diagnostics.join("; ") || "unknown parse error"}`
    );
  }
  if (document.doctype) {
    fail(`XML document types are prohibited in ${path}`);
  }

  return document;
};

const readAndroidAttribute = (application, name) => {
  const attributeName = `android:${name}`;
  if (!application.hasAttribute(attributeName)) {
    fail(
      `Merged release manifest must define android:${name} exactly once; found 0`
    );
  }

  return application.getAttribute(attributeName);
};

const verifyManifest = (manifestPath) => {
  const manifest = parseXml(
    readRequiredFile(manifestPath, "Merged release manifest"),
    manifestPath
  );
  if (manifest.documentElement?.nodeName !== "manifest") {
    fail(
      `Merged release manifest has an invalid root element: ${manifestPath}`
    );
  }
  const applications = Array.from(manifest.getElementsByTagName("application"));
  if (applications.length !== 1) {
    fail(
      `Merged release manifest must define application exactly once; found ${applications.length}`
    );
  }

  const [application] = applications;
  const networkSecurityConfig = readAndroidAttribute(
    application,
    "networkSecurityConfig"
  );
  const usesCleartextTraffic = readAndroidAttribute(
    application,
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

const verifyCertificateSources = (document, path) => {
  const certificateTags = Array.from(
    document.getElementsByTagName("certificates")
  );
  if (certificateTags.length === 0) {
    fail(`Network Security Configuration has no trust anchors: ${path}`);
  }

  for (const certificateTag of certificateTags) {
    if (
      !certificateTag.hasAttribute("src") ||
      certificateTag.getAttribute("src") !== "system"
    ) {
      fail(
        `Network Security Configuration contains a non-system trust source in ${path}`
      );
    }
  }
};

const canonicalPolicyDirectories = new Map([
  ["xml", null],
  ["xml-v36", 36],
  ["xml-v37", 37],
]);

const readResourcePolicy = (resourcesRoot, path) => {
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

  if (
    directorySegments.length !== 1 ||
    !canonicalPolicyDirectories.has(xmlDirectory)
  ) {
    fail(
      `Merged release network security policies must use only the canonical xml, xml-v36, and xml-v37 directories: ${path}`
    );
  }

  return {
    directory: xmlDirectory,
    apiLevel: canonicalPolicyDirectories.get(xmlDirectory),
  };
};

const verifyApi36CertificateTransparency = (
  document,
  baseConfig,
  path,
  apiLevel
) => {
  const certificateTransparencyTags = Array.from(
    document.getElementsByTagName("certificateTransparency")
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

  const hasGlobalCtPolicy =
    certificateTransparencyTags.length === 1 &&
    certificateTransparencyTags[0].parentNode === baseConfig &&
    certificateTransparencyTags[0].getAttribute("enabled") === "true";

  if (!hasGlobalCtPolicy) {
    fail(
      `API 36 Network Security Configuration must enforce certificate transparency globally: ${path}`
    );
  }
};

const verifyApi37LocalhostHardening = (document, path, apiLevel) => {
  if (apiLevel !== 37) {
    return;
  }

  const explicitlyConfiguredLocalhost = Array.from(
    document.getElementsByTagName("domain")
  ).filter(
    (domain) =>
      domain.textContent.trim() === "localhost" &&
      domain.parentNode?.nodeName === "domain-config"
  );
  if (explicitlyConfiguredLocalhost.length !== 1) {
    fail(
      `API 37 Network Security Configuration must explicitly configure localhost exactly once to disable Android's implicit cleartext exception: ${path}`
    );
  }
};

const verifyNetworkSecurityConfig = (resourcesRoot, path) => {
  const document = parseXml(
    readRequiredFile(path, "Merged Network Security Configuration"),
    path
  );
  if (document.documentElement?.nodeName !== "network-security-config") {
    fail(`Network Security Configuration has an invalid root element: ${path}`);
  }
  const { apiLevel } = readResourcePolicy(resourcesRoot, path);
  const baseConfigs = Array.from(document.getElementsByTagName("base-config"));
  if (baseConfigs.length !== 1) {
    fail(`Network Security Configuration must define one base policy: ${path}`);
  }
  const [baseConfig] = baseConfigs;

  const policyConfigurations = [
    baseConfig,
    ...Array.from(document.getElementsByTagName("domain-config")),
  ];
  for (const configuration of policyConfigurations) {
    if (!configuration.hasAttribute("cleartextTrafficPermitted")) {
      continue;
    }

    const cleartextValue = configuration
      .getAttribute("cleartextTrafficPermitted")
      .toLowerCase();
    if (cleartextValue === "true") {
      fail(`Network Security Configuration permits cleartext traffic: ${path}`);
    }
    if (cleartextValue !== "false") {
      fail(
        `Network Security Configuration has an invalid cleartext policy value in ${path}`
      );
    }
  }

  if (
    !baseConfig.hasAttribute("cleartextTrafficPermitted") ||
    baseConfig.getAttribute("cleartextTrafficPermitted").toLowerCase() !==
      "false"
  ) {
    fail(
      `Network Security Configuration does not disable cleartext traffic in its base policy: ${path}`
    );
  }

  if (
    document.getElementsByTagName("pin-set").length > 0 ||
    document.getElementsByTagName("pin").length > 0
  ) {
    fail(
      `Network Security Configuration contains certificate pinning: ${path}`
    );
  }

  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (
      element.hasAttribute("overridePins") &&
      element.getAttribute("overridePins").toLowerCase() !== "false"
    ) {
      fail(`Network Security Configuration overrides pin validation: ${path}`);
    }
  }

  if (document.getElementsByTagName("debug-overrides").length > 0) {
    fail(
      `Network Security Configuration contains debug trust overrides: ${path}`
    );
  }

  verifyCertificateSources(document, path);
  verifyApi36CertificateTransparency(document, baseConfig, path, apiLevel);
  verifyApi37LocalhostHardening(document, path, apiLevel);
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

    const document = parseXml(readFileSync(path, "utf8"), path);
    return Array.from(document.getElementsByTagName("item")).some(
      (item) =>
        item.getAttribute("type") === "xml" &&
        item.getAttribute("name") === "network_security_config"
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

  const policyDirectories = configurations.map(
    (path) => readResourcePolicy(resourcesRoot, path).directory
  );
  const defaultConfigurations = policyDirectories.filter(
    (directory) => directory === "xml"
  );
  if (defaultConfigurations.length !== 1) {
    fail(
      `Merged release resources must define the fallback network security policy exactly once; found ${defaultConfigurations.length}`
    );
  }

  const api36Configurations = policyDirectories.filter(
    (directory) => directory === "xml-v36"
  );
  if (api36Configurations.length !== 1) {
    fail(
      `Merged release resources must define an API 36 network security policy exactly once; found ${api36Configurations.length}`
    );
  }

  const api37Configurations = policyDirectories.filter(
    (directory) => directory === "xml-v37"
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
