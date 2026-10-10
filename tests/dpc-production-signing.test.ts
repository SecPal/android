/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error The operational helper is an executable Node module.
import * as signing from "../scripts/dpc-production-signing.mjs";

const {
  validateAuthority,
  verifyApk,
  signApk,
  publicEnvironment,
  payloadDigest,
  verifyCandidate,
  verifyReturnedApk,
  certificateIdentity,
  readAuthority,
} = signing;

// Parser-only synthetic values, never evidence of a real signing authority.
const fixtureDigest = (name: string) =>
  createHash("sha256").update(`disposable-test:${name}`).digest("hex");
const dpc = fixtureDigest("dpc-certificate");
const work = fixtureDigest("work-certificate");
const dpcKey = fixtureDigest("dpc-public-key");
const workKey = fixtureDigest("work-public-key");
const authority = {
  application_id: "io.secpal.dpc",
  dpc_cert_sha256: dpc,
  work_cert_sha256: work,
  dpc_key_sha256: dpcKey,
  work_key_sha256: workKey,
};
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }))
);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "secpal-dpc-signing-"));
  roots.push(root);
  const apk = join(root, "candidate.apk");
  writeFileSync(apk, "public candidate");
  const run = vi.fn((tool: string, args: string[]) => {
    if (tool === "apksigner")
      return `Signer #1 certificate DN: CN=Disposable Test DPC\nSigner #1 certificate SHA-256 digest: ${dpc}\nSigner #1 public key SHA-256 digest: ${dpcKey}\n`;
    if (args.includes("application-id")) return "io.secpal.dpc\n";
    if (args.includes("version-code")) return "2026100501\n";
    if (args.includes("version-name")) return "0.1.0\n";
    if (args.includes("debuggable")) return "false\n";
    return "";
  });
  return { root, apk, run };
}

// A real ZIP exercises literal entry hashing and rejects payload replacement.
function zipFixture() {
  const f = fixture();
  // Stored ZIP with a single entry named a, content b (including CRC and central directory).
  writeFileSync(
    f.apk,
    Buffer.from(
      "504b030414000000000000000000f9efbe710100000001000000010000006162504b0102140014000000000000000000f9efbe71010000000100000001000000000000000000000000000000000061504b050600000000010001002f000000200000000000",
      "hex"
    )
  );
  return f;
}

async function candidateFor(apk: string) {
  return {
    ...authority,
    source_commit: "d".repeat(40),
    version_code: "2026100501",
    version_name: "0.1.0",
    candidate_sha256: createHash("sha256")
      .update(readFileSync(apk))
      .digest("hex"),
    payload_sha256: await payloadDigest(apk),
  };
}

describe("DPC production signing mechanism with synthetic fixtures", () => {
  it("requires an explicit external public authority and rejects checkout-local input", () => {
    expect(() => readAuthority({})).toThrow(/external/i);
    expect(() =>
      readAuthority({ SECPAL_DPC_PUBLIC_AUTHORITY_FILE: "" })
    ).toThrow();
    expect(() =>
      readAuthority({
        SECPAL_DPC_PUBLIC_AUTHORITY_FILE: join(process.cwd(), "package.json"),
      })
    ).toThrow(/outside/i);
  });

  it("consumes external public identities without a source change and fails closed on malformed input", () => {
    const { root } = fixture();
    const file = join(root, "disposable-public-authority.json");
    const env = { SECPAL_DPC_PUBLIC_AUTHORITY_FILE: file };
    writeFileSync(file, JSON.stringify(authority));
    expect(readAuthority(env)).toEqual(authority);
    writeFileSync(
      file,
      JSON.stringify({ ...authority, work_key_sha256: dpcKey })
    );
    expect(() => readAuthority(env)).toThrow();
    writeFileSync(file, "not JSON");
    expect(() => readAuthority(env)).toThrow();
  });
  it.each([
    {},
    { ...authority, dpc_cert_sha256: "" },
    { ...authority, dpc_cert_sha256: "a:b" },
    { ...authority, work_cert_sha256: "" },
    { ...authority, dpc_cert_sha256: work },
    { ...authority, application_id: "app.secpal" },
    { ...authority, dpc_key_sha256: workKey },
    { ...authority, work_key_sha256: "" },
  ])(
    "rejects incomplete, malformed or shared public authority: %j",
    (value) => {
      expect(() => validateAuthority(value)).toThrow();
    }
  );

  it("derives both peer inputs from the same public authority without credentials", () => {
    expect(validateAuthority(authority)).toEqual(authority);
    const env = publicEnvironment(
      {
        SECPAL_DPC_KEYSTORE_PASSWORD: "secret",
        SECPAL_ANDROID_KEY_PASSWORD: "secret",
        PATH: "/bin",
        SECPAL_DPC_CERT_SHA256: work,
      },
      authority
    );
    expect(env).toEqual({
      PATH: "/bin",
      SECPAL_DPC_CERT_SHA256: dpc,
      SECPAL_WORK_CERT_SHA256: work,
    });
  });

  it("verifies a single exact configured fixture signer and the DPC package/version", async () => {
    const { apk, run } = fixture();
    const evidence = await verifyApk(apk, authority, { run });
    expect(evidence).toMatchObject({
      application_id: "io.secpal.dpc",
      dpc_cert_sha256: dpc,
      work_cert_sha256: work,
      version_code: "2026100501",
      version_name: "0.1.0",
    });
    expect(evidence.artifact_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run).toHaveBeenCalledWith("apksigner", [
      "verify",
      "-Werr",
      "--verbose",
      "--print-certs",
      apk,
    ]);
  });

  it.each([
    ["Work signer", `Signer #1 certificate SHA-256 digest: ${work}\n`],
    [
      "certificate substitution",
      `Signer #1 certificate SHA-256 digest: ${"c".repeat(64)}\n`,
    ],
    [
      "debug signer",
      `Signer #1 certificate DN: CN=Android Debug, O=Android, C=US\nSigner #1 certificate SHA-256 digest: ${dpc}\n`,
    ],
    [
      "local DPC test signer",
      `Signer #1 certificate DN: CN=SecPal DPC Local Test\nSigner #1 certificate SHA-256 digest: ${dpc}\n`,
    ],
    [
      "multiple signers",
      `Signer #1 certificate SHA-256 digest: ${dpc}\nSigner #2 certificate SHA-256 digest: ${work}\n`,
    ],
    ["missing signer", ""],
  ])("rejects %s", async (_name, output) => {
    const { apk, run } = fixture();
    run.mockImplementation(
      () => output + `Signer #1 public key SHA-256 digest: ${dpcKey}\n`
    );
    await expect(verifyApk(apk, authority, { run })).rejects.toThrow();
  });

  it.each([
    "app.secpal",
    `${authority.application_id}.ctregression`,
    "secpal.dev",
  ])("rejects package substitution: %s", async (packageId) => {
    const { apk, run } = fixture();
    const original = run.getMockImplementation()!;
    run.mockImplementation((tool, args) =>
      args.includes("application-id") ? packageId : original(tool, args)
    );
    await expect(verifyApk(apk, authority, { run })).rejects.toThrow(/package/);
  });

  it("rejects debug APKs even with the expected certificate", async () => {
    const { apk, run } = fixture();
    const original = run.getMockImplementation()!;
    run.mockImplementation((tool, args) =>
      args.includes("debuggable") ? "true" : original(tool, args)
    );
    await expect(verifyApk(apk, authority, { run })).rejects.toThrow(/debug/);
  });

  it("rejects a different signer on supported API 24–27", async () => {
    const { apk, run } = fixture();
    const original = run.getMockImplementation()!;
    run.mockImplementation((tool, args) =>
      args.includes("--max-sdk-version")
        ? `Signer #1 certificate SHA-256 digest: ${work}`
        : original(tool, args)
    );
    await expect(verifyApk(apk, authority, { run })).rejects.toThrow(
      /certificate/
    );
  });

  it("rejects a shared Work key behind a different DPC certificate", async () => {
    const { apk, run } = fixture();
    const original = run.getMockImplementation()!;
    run.mockImplementation((tool, args) =>
      original(tool, args).replace(dpcKey, workKey)
    );
    await expect(verifyApk(apk, authority, { run })).rejects.toThrow(
      /certificate/
    );
  });

  it("rejects unclassified warnings in the older-platform certificate check", async () => {
    const { apk, run } = fixture();
    const original = run.getMockImplementation()!;
    run.mockImplementation(
      (tool, args) =>
        original(tool, args) +
        (args.includes("--max-sdk-version")
          ? "\nWARNING: Unexpected signing weakness"
          : "")
    );
    await expect(verifyApk(apk, authority, { run })).rejects.toThrow();
  });

  it("stops the maintained public peer-certificate extraction when keytool fails", () => {
    const workflow = readFileSync(
      ".github/workflows/android-enterprise-policy.yml",
      "utf8"
    );
    const block = workflow
      .split(
        "# Test certificates are generated separately; production trust is never substituted."
      )[1]
      .split("# Gradle selects")[0];
    const failedExtraction = block.replace(
      /keytool[\s\S]*?-alias androiddebugkey/,
      "false"
    );
    const result = spawnSync(
      "/usr/bin/bash",
      ["-e", "-o", "pipefail", "-c", failedExtraction + '\nprintf "continued"'],
      { encoding: "utf8" }
    );
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("continued");
  });

  it("fails before key access when local signing credentials are missing or CI is active", async () => {
    const { apk, run, root } = fixture();
    for (const env of [
      {},
      { CI: "true", SECPAL_DPC_KEYSTORE_PATH: "never-read" },
    ]) {
      await expect(
        signApk(apk, join(root, "signed.apk"), authority, {}, { run, env })
      ).rejects.toThrow();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("binds a returned signed artifact to the approved candidate and exact source/version", async () => {
    const { apk, run } = zipFixture();
    const candidate = await candidateFor(apk);
    const evidence = await verifyReturnedApk(apk, apk, authority, candidate, {
      run,
    });
    expect(evidence).toMatchObject({
      source_commit: candidate.source_commit,
      candidate_sha256: candidate.candidate_sha256,
    });
    await expect(
      verifyReturnedApk(
        apk,
        apk,
        authority,
        { ...candidate, version_code: "1" },
        { run }
      )
    ).rejects.toThrow();
    await expect(
      verifyReturnedApk(
        apk,
        apk,
        authority,
        { ...candidate, payload_sha256: "e".repeat(64) },
        { run }
      )
    ).rejects.toThrow();
  });

  it("rejects altered candidate evidence before signing", async () => {
    const { apk, run } = zipFixture();
    const candidate = await candidateFor(apk);
    await expect(
      verifyCandidate(apk, authority, candidate, { run })
    ).resolves.toMatchObject({ application_id: "io.secpal.dpc" });
    for (const change of [
      { candidate_sha256: "e".repeat(64) },
      { work_cert_sha256: dpc },
      { source_commit: "main" },
    ]) {
      await expect(
        verifyCandidate(apk, authority, { ...candidate, ...change }, { run })
      ).rejects.toThrow();
    }
  });

  it("rejects signed payload replacement even when package/version and certificate match", async () => {
    const { root, apk, run } = zipFixture();
    const candidate = await candidateFor(apk);
    const signed = join(root, "substitution.apk");
    const bytes = readFileSync(apk);
    bytes[31] = 0x63;
    writeFileSync(signed, bytes);
    await expect(
      verifyReturnedApk(signed, apk, authority, candidate, { run })
    ).rejects.toThrow(/payload/);
  });

  it("signs with purpose-specific env password references and removes failed outputs", async () => {
    const { root, apk, run } = zipFixture();
    const candidate = await candidateFor(apk);
    const keystore = join(root, "disposable-test-only.jks");
    writeFileSync(keystore, "mock test store, not a production key");
    chmodSync(keystore, 0o600);
    const env = {
      SECPAL_DPC_LOCAL_SIGNING: "offline-operator",
      SECPAL_DPC_KEYSTORE_PATH: keystore,
      SECPAL_DPC_KEYSTORE_PASSWORD: "test-store-pass",
      SECPAL_DPC_KEY_ALIAS: "test-alias",
      SECPAL_DPC_KEY_PASSWORD: "test-key-pass",
    };
    const original = run.getMockImplementation()!;
    run.mockImplementation((tool, args) => {
      if (tool === "zipalign" && args.includes("-f"))
        copyFileSync(apk, args.at(-1)!);
      if (tool === "apksigner" && args[0] === "sign")
        copyFileSync(apk, args[args.indexOf("--out") + 1]);
      return original(tool, args);
    });
    const signed = join(root, "signed.apk");
    await expect(
      signApk(apk, signed, authority, candidate, { run, env })
    ).resolves.toMatchObject({ dpc_cert_sha256: dpc });
    const signingCall = run.mock.calls.find(
      ([tool, args]) => tool === "apksigner" && args[0] === "sign"
    )!;
    expect(signingCall[1]).toContain("env:SECPAL_DPC_KEYSTORE_PASSWORD");
    expect(signingCall[1]).toContain("env:SECPAL_DPC_KEY_PASSWORD");
    expect(JSON.stringify(run.mock.calls)).not.toContain("test-store-pass");
    expect(JSON.stringify(run.mock.calls)).not.toContain("test-key-pass");
    const rejected = join(root, "wrong-signer.apk");
    const goodRun = run.getMockImplementation()!;
    run.mockImplementation((tool, args) =>
      tool === "apksigner" && args[0] === "verify"
        ? `Signer #1 certificate SHA-256 digest: ${work}`
        : goodRun(tool, args)
    );
    await expect(
      signApk(apk, rejected, authority, candidate, { run, env })
    ).rejects.toThrow(/certificate/);
    expect(existsSync(rejected)).toBe(false);
    expect(
      readdirSync(root).filter((name) => name.startsWith(".dpc-sign-"))
    ).toEqual([]);
  });

  it("preserves Work signing inputs and requires an explicit unsigned DPC boundary", () => {
    const gradle = readFileSync("android/dpc/build.gradle", "utf8");
    expect(gradle).toContain("secpalDpcUnsignedCandidate");
    expect(gradle).toContain("verifyDpcReleaseInputs");
    expect(gradle).not.toContain("SECPAL_ANDROID_KEYSTORE");
    const workGradle = readFileSync("android/app/build.gradle", "utf8");
    expect(workGradle).toContain("storeFile file(releaseKeystorePath)");
    expect(workGradle).toContain("keyPassword releaseKeyPassword");
  });
});

// Explicit SDK qualification uses disposable keys and a copied source tree;
// production public/private material is never read or generated by this test.
describe.skipIf(!process.env.SECPAL_DPC_SIGNING_SDK_TESTS)(
  "Android SDK signing qualification",
  () => {
    it("builds without a key, signs and recovers with one test authority, and rejects substitutions", async () => {
      const root = mkdtempSync(join(tmpdir(), "secpal-dpc-sdk-"));
      roots.push(root);
      const keyRoot = mkdtempSync(
        join(tmpdir(), "secpal-dpc-disposable-keys-")
      );
      roots.push(keyRoot);
      cpSync("android", join(root, "android"), {
        recursive: true,
        filter: (path) =>
          !/(?:^|\/)(?:build|\.gradle|local\.properties)(?:\/|$)/.test(path),
      });
      for (const name of ["VERSION", "package.json", "package-lock.json"])
        copyFileSync(name, join(root, name));
      symlinkSync(
        join(process.cwd(), "node_modules"),
        join(root, "node_modules")
      );
      symlinkSync(join(process.cwd(), "scripts"), join(root, "scripts"));
      const env: NodeJS.ProcessEnv = publicEnvironment(process.env, authority);
      delete env.SECPAL_DPC_CERT_SHA256;
      delete env.SECPAL_WORK_CERT_SHA256;
      delete env.SECPAL_DPC_PUBLIC_AUTHORITY_FILE;
      env.SECPAL_DPC_VERSION_CODE = "2026100501";
      const execute = (
        tool: string,
        args: string[],
        values: NodeJS.ProcessEnv = env
      ) =>
        spawnSync(tool, args, {
          env: values,
          encoding: "utf8",
          timeout: 240000,
          maxBuffer: 16 * 1024 * 1024,
        });
      const gradle = (args: string[], values: NodeJS.ProcessEnv = env) =>
        execute(
          join(root, "android/gradlew"),
          [
            "--no-daemon",
            "--console=plain",
            "-p",
            join(root, "android"),
            ...args,
          ],
          values
        );
      const requireSuccess = (result: ReturnType<typeof spawnSync>) => {
        if (result.status !== 0)
          throw new Error(
            "Disposable Android qualification tool failed; diagnostics suppressed"
          );
      };
      // No private input is needed, and missing authority is fail-closed.
      expect(
        gradle([
          ":dpc:verifyDpcReleaseInputs",
          "-PsecpalDpcUnsignedCandidate=true",
        ]).status
      ).not.toBe(0);
      const keys = [
        "qualification-dpc",
        "qualification-work",
        "qualification-debug",
      ];
      const subjects = [
        "CN=SecPal Disposable Qualification Only",
        "CN=SecPal Disposable Work Qualification",
        "CN=Android Debug,O=Android,C=US",
      ];
      const digests: string[] = [];
      const publicKeys: string[] = [];
      for (const [index, name] of keys.entries()) {
        const path = join(keyRoot, `${name}.jks`);
        requireSuccess(
          execute("keytool", [
            "-genkeypair",
            "-keystore",
            path,
            "-storepass",
            "test-only-password",
            "-keypass",
            "test-only-password",
            "-alias",
            "qualification",
            "-keyalg",
            "RSA",
            "-keysize",
            "2048",
            "-validity",
            "2",
            "-dname",
            subjects[index],
          ])
        );
        chmodSync(path, 0o600);
        const certificate = spawnSync(
          "keytool",
          [
            "-exportcert",
            "-keystore",
            path,
            "-storepass",
            "test-only-password",
            "-alias",
            "qualification",
          ],
          { env }
        );
        requireSuccess(certificate);
        if (index < 2) {
          const identity = certificateIdentity(certificate.stdout);
          expect(
            certificateIdentity(
              new X509Certificate(certificate.stdout).toString()
            )
          ).toEqual(identity);
          digests.push(identity.cert_sha256);
          publicKeys.push(identity.key_sha256);
        } else
          digests.push(
            createHash("sha256").update(certificate.stdout).digest("hex")
          );
      }
      const testAuthority = {
        application_id: "io.secpal.dpc",
        dpc_cert_sha256: digests[0],
        work_cert_sha256: digests[1],
        dpc_key_sha256: publicKeys[0],
        work_key_sha256: publicKeys[1],
      };
      const checkoutLocalInput = join(
        root,
        "qualification-public-authority.json"
      );
      writeFileSync(checkoutLocalInput, JSON.stringify(testAuthority));
      expect(
        gradle(
          [":dpc:verifyDpcReleaseInputs", "-PsecpalDpcUnsignedCandidate=true"],
          {
            ...env,
            SECPAL_DPC_PUBLIC_AUTHORITY_FILE: checkoutLocalInput,
          }
        ).status
      ).not.toBe(0);
      env.SECPAL_DPC_PUBLIC_AUTHORITY_FILE = join(
        keyRoot,
        "qualification-public-authority.json"
      );
      writeFileSync(
        env.SECPAL_DPC_PUBLIC_AUTHORITY_FILE,
        JSON.stringify(testAuthority)
      );
      expect(gradle([":dpc:verifyDpcReleaseInputs"]).status).not.toBe(0);
      const conflict = gradle([":dpc:verifyProductionPeerPins"], {
        ...env,
        SECPAL_WORK_CERT_SHA256: digests[2],
      });
      expect(conflict.stdout + conflict.stderr).toContain(
        "Peer certificate input conflicts"
      );
      requireSuccess(
        gradle([":dpc:assembleRelease", "-PsecpalDpcUnsignedCandidate=true"])
      );
      requireSuccess(gradle([":app:generateReleaseBuildConfig"]));
      expect(
        readFileSync(
          join(
            root,
            "android/app/build/generated/source/buildConfig/release/app/secpal/BuildConfig.java"
          ),
          "utf8"
        )
      ).toContain(digests[0]);
      expect(
        readFileSync(
          join(
            root,
            "android/dpc/build/generated/source/buildConfig/release/io/secpal/dpc/BuildConfig.java"
          ),
          "utf8"
        )
      ).toContain(digests[1]);
      requireSuccess(
        gradle(
          [
            ":dpc:generateCtRegressionBuildConfig",
            ":app:generateCtRegressionBuildConfig",
          ],
          {
            ...env,
            SECPAL_DPC_CERT_SHA256: digests[2],
            SECPAL_WORK_CERT_SHA256: digests[0],
          }
        )
      );
      const apk = join(
        root,
        "android/dpc/build/outputs/apk/release/dpc-release-unsigned.apk"
      );
      const candidate = {
        ...testAuthority,
        source_commit: "d".repeat(40),
        version_name: "0.1.0",
        version_code: env.SECPAL_DPC_VERSION_CODE,
        candidate_sha256: createHash("sha256")
          .update(readFileSync(apk))
          .digest("hex"),
        payload_sha256: await payloadDigest(apk),
      };
      const localEnv: NodeJS.ProcessEnv = {
        ...env,
        SECPAL_DPC_LOCAL_SIGNING: "offline-operator",
        SECPAL_DPC_KEYSTORE_PATH: join(keyRoot, `${keys[0]}.jks`),
        SECPAL_DPC_KEYSTORE_PASSWORD: "test-only-password",
        SECPAL_DPC_KEY_ALIAS: "qualification",
        SECPAL_DPC_KEY_PASSWORD: "test-only-password",
      };
      // Simulate only the offline signer subprocess with disposable test keys.
      // The real helper still rejects hosted CI, as asserted above.
      delete localEnv.CI;
      delete localEnv.GITHUB_ACTIONS;
      requireSuccess(gradle([":dpc:verifyDpcSigningAuthority"], localEnv));
      const signed = join(root, "signed.apk");
      const result = await signApk(apk, signed, testAuthority, candidate, {
        env: localEnv,
      });
      expect(result).toMatchObject({
        application_id: "io.secpal.dpc",
        dpc_cert_sha256: digests[0],
        candidate_sha256: candidate.candidate_sha256,
      });
      // Restore a test backup locally and prove certificate continuity on a fresh output.
      const restored = join(keyRoot, "restored-test-backup.jks");
      copyFileSync(join(keyRoot, `${keys[0]}.jks`), restored);
      chmodSync(restored, 0o600);
      await expect(
        signApk(apk, join(root, "recovered.apk"), testAuthority, candidate, {
          env: { ...localEnv, SECPAL_DPC_KEYSTORE_PATH: restored },
        })
      ).resolves.toMatchObject({ dpc_cert_sha256: digests[0] });
      for (const name of keys.slice(1)) {
        const output = join(root, `${name}-rejected.apk`);
        await expect(
          signApk(apk, output, testAuthority, candidate, {
            env: {
              ...localEnv,
              SECPAL_DPC_KEYSTORE_PATH: join(keyRoot, `${name}.jks`),
            },
          })
        ).rejects.toThrow(/certificate/);
        expect(existsSync(output)).toBe(false);
        expect(
          gradle([":dpc:verifyDpcSigningAuthority"], {
            ...localEnv,
            SECPAL_DPC_KEYSTORE_PATH: join(keyRoot, `${name}.jks`),
          }).status
        ).not.toBe(0);
      }
    }, 480000);
  }
);
