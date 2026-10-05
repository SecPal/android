#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openLiteralZipArchive } from "./literal-zip-archive.mjs";
import { verifyVersionSync } from "./verify-version-sync.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const signingInput = /^SECPAL_(?:DPC|ANDROID)_(?:KEYSTORE_|KEY_)/;

export function validateAuthority(value) {
  if (
    value?.application_id !== "io.secpal.dpc" ||
    !/^[a-f0-9]{64}$/.test(value.dpc_cert_sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(value.work_cert_sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(value.dpc_key_sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(value.work_key_sha256 ?? "") ||
    value.dpc_cert_sha256 === value.work_cert_sha256 ||
    value.dpc_key_sha256 === value.work_key_sha256 ||
    Object.keys(value).sort().join(",") !==
      "application_id,dpc_cert_sha256,dpc_key_sha256,work_cert_sha256,work_key_sha256"
  ) {
    throw new Error(
      "Missing or invalid public DPC production signing authority"
    );
  }
  return value;
}

export function certificateIdentity(bytes) {
  const certificate = new X509Certificate(bytes);
  if (/Android Debug|SecPal DPC Local Test/i.test(certificate.subject))
    throw new Error("Test certificates are not production authority");
  return {
    cert_sha256: sha256(certificate.raw),
    key_sha256: sha256(
      certificate.publicKey.export({ type: "spki", format: "der" })
    ),
  };
}

export function readAuthority(env = process.env) {
  const input = env.SECPAL_DPC_PUBLIC_AUTHORITY_FILE;
  if (typeof input !== "string" || !input.trim())
    throw new Error(
      "An explicit external public DPC/Work authority is required"
    );
  let authorityPath;
  try {
    authorityPath = realpathSync(input);
  } catch {
    throw new Error("Cannot read external public DPC/Work authority");
  }
  if (authorityPath.startsWith(realpathSync(repoRoot) + sep))
    throw new Error(
      "Public signing authority input must remain outside the checkout"
    );
  try {
    return validateAuthority(JSON.parse(readFileSync(authorityPath, "utf8")));
  } catch {
    throw new Error("Missing or invalid external public DPC/Work authority");
  }
}

export function publicEnvironment(env, authority) {
  validateAuthority(authority);
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) => !signingInput.test(key))
    ),
    SECPAL_DPC_CERT_SHA256: authority.dpc_cert_sha256,
    SECPAL_WORK_CERT_SHA256: authority.work_cert_sha256,
  };
}

function runTool(tool, args, env = process.env) {
  const sdk = env.ANDROID_SDK_ROOT || env.ANDROID_HOME;
  let executable = tool;
  if (sdk && ["apksigner", "zipalign"].includes(tool))
    executable = join(sdk, "build-tools/35.0.0", tool);
  if (sdk && tool === "apkanalyzer")
    executable = join(sdk, "cmdline-tools/latest/bin/apkanalyzer");
  const result = spawnSync(executable, args, {
    env: { ...env, LC_ALL: "C" },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  // Signing diagnostics can include keystore locations or provider information.
  // Never relay command arguments, child output, environment or error objects.
  if (result.error || result.status !== 0)
    throw new Error(
      `${tool === "apksigner" ? "APK signing/verification" : "Required Android/release tool"} failed; child output suppressed`
    );
  return (
    tool === "apksigner" && args[0] === "verify"
      ? `${result.stdout}\n${result.stderr}`
      : result.stdout
  ).trim();
}

function inspectApk(apk, run) {
  const field = (name) => run("apkanalyzer", ["manifest", name, apk]).trim();
  if (field("application-id") !== "io.secpal.dpc")
    throw new Error("Unexpected DPC package identity");
  if (field("debuggable") !== "false")
    throw new Error("DPC production artifact must not be debuggable");
  return {
    application_id: "io.secpal.dpc",
    version_code: field("version-code"),
    version_name: field("version-name"),
  };
}

function requireCertificate(output, authority, legacyPlatform = false) {
  const expectedLegacyDiagnostic =
    "WARNING: APK Signature Scheme v2 signer #1: APK Signature Scheme v2 signer: 0 references unknown APK signature scheme ID: 3";
  const warnings = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("WARNING:"));
  const signers = [
    ...output.matchAll(
      /^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$/gm
    ),
  ];
  const keys = [
    ...output.matchAll(
      /^Signer #\d+ public key SHA-256 digest: ([a-f0-9]{64})$/gm
    ),
  ];
  if (
    signers.length !== 1 ||
    signers[0][1] !== authority.dpc_cert_sha256 ||
    keys.length !== 1 ||
    keys[0][1] !== authority.dpc_key_sha256 ||
    /certificate DN:.*(?:Android Debug|SecPal DPC Local Test)/i.test(output) ||
    warnings.some(
      (warning) => !legacyPlatform || warning !== expectedLegacyDiagnostic
    )
  ) {
    throw new Error("Unexpected or test DPC signing certificate");
  }
}

function verificationRunner(authority, run) {
  return (
    run ??
    ((tool, args) =>
      runTool(tool, args, publicEnvironment(process.env, authority)))
  );
}

export async function verifyApk(apk, authority, { run } = {}) {
  validateAuthority(authority);
  run = verificationRunner(authority, run);
  const verify = ["verify", "-Werr", "--verbose", "--print-certs"];
  requireCertificate(run("apksigner", [...verify, apk]), authority);
  // Android 7/8 use v2, while newer Android versions prefer v3. Neither may
  // silently use a different signer through an externally supplied lineage.
  // Build Tools 35 warns that API <=27 does not understand the intentional v3
  // stripping-protection reference in v2. Classify exactly that diagnostic;
  // every other warning and every signature/certificate failure remains fatal.
  requireCertificate(
    run("apksigner", [
      ...verify.filter((argument) => argument !== "-Werr"),
      "--min-sdk-version",
      "24",
      "--max-sdk-version",
      "27",
      apk,
    ]),
    authority,
    true
  );
  run("zipalign", ["-c", "-P", "16", "4", apk]);
  return {
    ...inspectApk(apk, run),
    ...authority,
    artifact_sha256: sha256(readFileSync(apk)),
  };
}

// v2/v3 signatures live outside ZIP entries. With v1 disabled every payload entry
// must remain identical; package/version checks alone cannot detect substitution.
export async function payloadDigest(apk) {
  const archive = await openLiteralZipArchive(apk);
  try {
    const entries = [];
    for (const name of [...archive.entries].sort())
      entries.push([name, await archive.hashEntry(name)]);
    return sha256(JSON.stringify(entries));
  } finally {
    archive.close();
  }
}

export async function verifyCandidate(apk, authority, candidate, { run } = {}) {
  validateAuthority(authority);
  run = verificationRunner(authority, run);
  const identity = inspectApk(apk, run);
  if (
    candidate.application_id !== authority.application_id ||
    Object.keys(candidate).sort().join(",") !==
      "application_id,candidate_sha256,dpc_cert_sha256,dpc_key_sha256,payload_sha256,source_commit,version_code,version_name,work_cert_sha256,work_key_sha256" ||
    !/^[a-f0-9]{40}$/.test(candidate.source_commit ?? "") ||
    candidate.candidate_sha256 !== sha256(readFileSync(apk)) ||
    candidate.payload_sha256 !== (await payloadDigest(apk)) ||
    candidate.dpc_cert_sha256 !== authority.dpc_cert_sha256 ||
    candidate.work_cert_sha256 !== authority.work_cert_sha256 ||
    candidate.dpc_key_sha256 !== authority.dpc_key_sha256 ||
    candidate.work_key_sha256 !== authority.work_key_sha256 ||
    candidate.version_code !== identity.version_code ||
    candidate.version_name !== identity.version_name
  ) {
    throw new Error(
      "Candidate does not match approved source/version/public authority evidence"
    );
  }
  return identity;
}

export async function verifyReturnedApk(
  signed,
  apk,
  authority,
  candidate,
  { run } = {}
) {
  run = verificationRunner(authority, run);
  await verifyCandidate(apk, authority, candidate, { run });
  const evidence = await verifyApk(signed, authority, { run });
  if (
    (await payloadDigest(signed)) !== candidate.payload_sha256 ||
    evidence.version_code !== candidate.version_code ||
    evidence.version_name !== candidate.version_name
  ) {
    throw new Error(
      "Signed APK payload/version differs from the approved candidate"
    );
  }
  return {
    ...evidence,
    source_commit: candidate.source_commit,
    candidate_sha256: candidate.candidate_sha256,
  };
}

export async function signApk(
  apk,
  output,
  authority,
  candidate,
  { run, env = process.env } = {}
) {
  validateAuthority(authority);
  const names = [
    "SECPAL_DPC_KEYSTORE_PATH",
    "SECPAL_DPC_KEYSTORE_PASSWORD",
    "SECPAL_DPC_KEY_ALIAS",
    "SECPAL_DPC_KEY_PASSWORD",
  ];
  if (
    env.CI ||
    env.GITHUB_ACTIONS ||
    env.SECPAL_DPC_LOCAL_SIGNING !== "offline-operator" ||
    !names.every((name) => typeof env[name] === "string" && env[name].trim())
  ) {
    throw new Error(
      "Signing requires an offline operator environment and all four SECPAL_DPC signing inputs"
    );
  }
  const keystore = realpathSync(env.SECPAL_DPC_KEYSTORE_PATH);
  const info = statSync(keystore);
  if (
    !info.isFile() ||
    info.mode & 0o077 ||
    info.uid !== process.getuid() ||
    keystore.startsWith(realpathSync(repoRoot) + sep)
  )
    throw new Error(
      "DPC key must remain in protected operator custody outside the repository"
    );
  if (existsSync(output) || resolve(apk) === resolve(output))
    throw new Error("Signed output must be a new file");
  const publicEnv = publicEnvironment(env, authority);
  const publicRun = run ?? ((tool, args) => runTool(tool, args, publicEnv));
  await verifyCandidate(apk, authority, candidate, { run: publicRun });
  const scratch = mkdtempSync(join(dirname(resolve(output)), ".dpc-sign-"));
  try {
    const aligned = join(scratch, "aligned.apk");
    const signed = join(scratch, "signed.apk");
    publicRun("zipalign", ["-P", "16", "-f", "4", apk, aligned]);
    const signEnv = {
      ...publicEnv,
      ...Object.fromEntries(names.map((name) => [name, env[name]])),
    };
    (run ?? ((tool, args) => runTool(tool, args, signEnv)))("apksigner", [
      "sign",
      "--ks",
      keystore,
      "--ks-key-alias",
      env.SECPAL_DPC_KEY_ALIAS,
      "--ks-pass",
      "env:SECPAL_DPC_KEYSTORE_PASSWORD",
      "--key-pass",
      "env:SECPAL_DPC_KEY_PASSWORD",
      "--v1-signing-enabled",
      "false",
      "--v2-signing-enabled",
      "true",
      "--v3-signing-enabled",
      "true",
      "--v4-signing-enabled",
      "false",
      "--out",
      signed,
      aligned,
    ]);
    const evidence = await verifyReturnedApk(
      signed,
      apk,
      authority,
      candidate,
      { run: publicRun }
    );
    renameSync(signed, output);
    return evidence;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function buildCandidate(authority) {
  const env = publicEnvironment(process.env, authority);
  const run = (tool, args) => runTool(tool, args, env);
  if (run("git", ["-C", repoRoot, "status", "--porcelain"]))
    throw new Error("Candidate requires a clean committed source tree");
  const sourceCommit = run("git", ["-C", repoRoot, "rev-parse", "HEAD"]);
  const version = verifyVersionSync({ repoRoot });
  const code = env.SECPAL_DPC_VERSION_CODE;
  run("ruby", [
    "-r",
    join(repoRoot, "fastlane/lib/secpal_android_versioning.rb"),
    "-e",
    "SecPalAndroidVersioning.validate_current_build_code!(ENV.fetch('SECPAL_DPC_VERSION_CODE'))",
  ]);
  run(join(repoRoot, "android/gradlew"), [
    "--no-daemon",
    "--console=plain",
    "-p",
    join(repoRoot, "android"),
    ":dpc:clean",
    ":dpc:assembleRelease",
    "-PsecpalDpcUnsignedCandidate=true",
  ]);
  const apk = join(
    repoRoot,
    "android/dpc/build/outputs/apk/release/dpc-release-unsigned.apk"
  );
  const identity = inspectApk(apk, run);
  if (identity.version_code !== code || identity.version_name !== version)
    throw new Error("DPC candidate version mismatch");
  const evidence = {
    ...identity,
    ...authority,
    source_commit: sourceCommit,
    candidate_sha256: sha256(readFileSync(apk)),
    payload_sha256: await payloadDigest(apk),
  };
  writeFileSync(`${apk}.json`, JSON.stringify(evidence, null, 2) + "\n", {
    flag: "wx",
  });
  return evidence;
}

async function main() {
  const [command, apk, output] = process.argv.slice(2);
  if (command === "identity" && apk && output) {
    const dpc = certificateIdentity(readFileSync(apk));
    const work = certificateIdentity(readFileSync(output));
    return validateAuthority({
      application_id: "io.secpal.dpc",
      dpc_cert_sha256: dpc.cert_sha256,
      dpc_key_sha256: dpc.key_sha256,
      work_cert_sha256: work.cert_sha256,
      work_key_sha256: work.key_sha256,
    });
  }
  const authority = readAuthority();
  const env = publicEnvironment(process.env, authority);
  const options = { run: (tool, args) => runTool(tool, args, env) };
  if (command === "pins" && !apk) return publicEnvironment({}, authority);
  if (command === "build" && !apk) return buildCandidate(authority);
  if (command === "verify" && apk && !output)
    return verifyApk(apk, authority, options);
  if (command === "verify" && apk && output)
    return verifyReturnedApk(
      apk,
      output,
      authority,
      JSON.parse(readFileSync(`${output}.json`, "utf8")),
      options
    );
  if (command === "sign" && apk && output)
    return signApk(
      apk,
      output,
      authority,
      JSON.parse(readFileSync(`${apk}.json`, "utf8"))
    );
  throw new Error(
    "Usage: dpc-production-signing.mjs identity DPC_PUBLIC_CERT WORK_PUBLIC_CERT | pins | build | sign CANDIDATE.apk SIGNED.apk | verify SIGNED.apk [CANDIDATE.apk]"
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main()
    .then((evidence) => console.log(JSON.stringify(evidence, null, 2)))
    .catch(() => {
      console.error(
        "DPC operation rejected. Check public authority, candidate evidence, SDK tools and offline operator inputs; no child diagnostics are logged."
      );
      process.exitCode = 1;
    });
}
