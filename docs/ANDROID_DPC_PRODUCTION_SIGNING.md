<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# DPC Production Signing

This is the local/offline operator boundary for issue #715. It uses the existing
`io.secpal.dpc` production authority. It neither publishes nor provisions DPC.
Application signing grants no endpoint identity, user, session or business authority.
Work (`app.secpal`) retains its existing signing inputs and release procedures.

## Public Continuity Authority

Before a production candidate can be built, supply the operator-confirmed existing
public identities in an external JSON file, outside every source checkout. Select
that file using `SECPAL_DPC_PUBLIC_AUTHORITY_FILE`. No production identity is
committed, and later evidence requires no source change:

```json
{
  "application_id": "io.secpal.dpc",
  "dpc_cert_sha256": "<existing DPC certificate SHA-256, 64 lowercase hex digits>",
  "dpc_key_sha256": "<existing DPC public key SPKI SHA-256, 64 lowercase hex digits>",
  "work_cert_sha256": "<existing Work certificate SHA-256, 64 lowercase hex digits>",
  "work_key_sha256": "<existing Work public key SPKI SHA-256, 64 lowercase hex digits>"
}
```

Keep the approved public JSON and its SHA-256 in the operator's continuity records.
Use the same approved record for each release; choosing a different input file
does not authorize a changed identity. Never substitute a generated key or infer
production identity from an alias or package name. Confirm the DPC fingerprint
against the existing Google-registered public identity. Public X.509 certificates
or `apksigner verify --print-certs` output are sufficient evidence; no Google
mutation is required.

Derive both certificate and public-key identities from existing public PEM/DER
certificates without accessing a keystore:

```bash
node scripts/dpc-production-signing.mjs identity \
  /operator/public/dpc-signing-certificate.der \
  /operator/public/work-signing-certificate.der
```

The command prints the public JSON above and rejects shared keys and known test
certificate subjects. Confirm each certificate's application role independently;
an X.509 subject name alone is not Android application identity. Different
certificate fingerprints with the same public key are insufficient separation.

Select the external record for all subsequent commands:

```bash
export SECPAL_DPC_PUBLIC_AUTHORITY_FILE=/operator/public/dpc-work-authority.json
```

Both applications derive their existing peer pins from this external public file:
`SECPAL_DPC_CERT_SHA256` for Work and `SECPAL_WORK_CERT_SHA256` for DPC. Conflicting
production overrides fail closed; debug/ctRegression retain separate test pins.
`node scripts/dpc-production-signing.mjs pins`
prints only these public inputs. Missing runtime pins still deny management trust.
Changing Work's peer pin does not change Work's signing authority.

Normal releases preserve these identities. Loss, suspected compromise, intentional
replacement or retirement stops signing and requires a separately authorized
contract. No automatic rotation, shared key, debug fallback or signing lineage is
introduced. Do not use the Work upload-key recovery procedure for DPC.

## Candidate Build Without Private Material

Use Node 22+, JDK 21, the repository's locked dependencies, Android SDK platform 36,
Build Tools 35.0.0 and command-line tools (`apkanalyzer`). Run from a clean committed
checkout. The candidate uses `VERSION`; choose an explicit DPC version code using
the existing `YYYYMMDDXX` convention and version validator. Future codes must
increase above previously accepted DPC codes; Work publication state is independent.

```bash
SECPAL_DPC_VERSION_CODE=2026100501 \
  bash scripts/with-android-env.sh node scripts/dpc-production-signing.mjs build
```

The helper removes Work and DPC signing inputs from child environments, validates
the code with the existing release validator, and packages an unsigned release:

- `android/dpc/build/outputs/apk/release/dpc-release-unsigned.apk`
- the adjacent `.apk.json`: exact source commit, version, candidate/payload SHA-256,
  application ID and both public certificate pins.

Keep the candidate and evidence together. Check the source commit against the
approved release checkout and candidate hash before handing them to the operator.
The JSON is a non-secret record, not an independent source attestation. Only these
explicit artifacts may be transferred. Production credentials never enter CI,
SecPal servers, Git, hosted secrets, generic artifact uploads or runtime assets.

Without the external authority, the production build/sign/verify commands fail
closed. Repository tests and hosted CI instead use explicitly disposable test
identities in isolated temporary checkouts. Their unsigned candidate and signed
fixture prove the mechanism, and are never production release evidence. A real
candidate must be rebuilt using the accepted production pins because the peer
trust input is part of its payload.

## Offline Operator Signing And Independent Verification

Bring the candidate, adjacent JSON, reviewed scripts/external public authority and prepared
SDK to the operator-controlled offline environment. The existing keystore stays
outside every Git checkout, owned by the operator and with mode 600 or stricter.
Load the four existing purpose-specific inputs through protected local custody:

- `SECPAL_DPC_KEYSTORE_PATH`
- `SECPAL_DPC_KEYSTORE_PASSWORD`
- `SECPAL_DPC_KEY_ALIAS`
- `SECPAL_DPC_KEY_PASSWORD`

Do not type passwords into command arguments or shell history. Do not use shell
tracing, environment dumps, Gradle debug logs or session recording. Never send
these values, the keystore, private key or recovery secrets to the delivery worker.

```bash
SECPAL_DPC_LOCAL_SIGNING=offline-operator \
  bash scripts/with-android-env.sh node scripts/dpc-production-signing.mjs sign \
  android/dpc/build/outputs/apk/release/dpc-release-unsigned.apk \
  /operator/artifacts/dpc-release.apk
```

The helper aligns before signing, passes passwords using `apksigner` environment
references, disables v1/v4, uses one v2/v3 signer, rejects CI, verifies before
retaining the signed APK and removes failed temporary outputs. It suppresses child
diagnostics. The offline acknowledgment is an operator assertion, not network
isolation enforcement. Prepare the environment before disconnecting it.

Independent verification requires no signing credentials:

```bash
bash scripts/with-android-env.sh node scripts/dpc-production-signing.mjs verify \
  /operator/artifacts/dpc-release.apk \
  android/dpc/build/outputs/apk/release/dpc-release-unsigned.apk
```

Return only the signed APK and verifier JSON (application ID, version, source
commit, artifact/candidate SHA-256, DPC/Work certificate and public-key SHA-256). Verification
checks Android signature validity, exact DPC certificate, one signer, package
`io.secpal.dpc`, non-debug manifest, alignment and unchanged candidate ZIP payload.
The pinned certificate must be independently confirmed distinct from Work,
Android debug/ctRegression and local DPC test authorities before acceptance.
Public certificates from those artifacts suffice. No private key is needed.

## Same-Key Backup And Recovery Drill

Keep encrypted operator-controlled offline backups in two separately protected
physical locations. Back up the existing DPC keystore and the means to unlock its
exact alias using the operator's existing local backup mechanism. Keep recovery
credentials separate from the encrypted backup. Never store even an encrypted
private-key copy in Git, on SecPal servers, in hosted CI or in returned evidence.

Restore a backup on a separate trusted offline workstation, outside its checkout,
with owner-only permissions. Run the same `sign` command on the same approved
candidate, choosing a new output path, then the same `verify` command. A different
certificate, missing alias, wrong password or failed verification stops recovery;
do not generate a replacement or fall back to Work/debug signing.

Return only the recovery verifier JSON and operator confirmation of drill date,
same-certificate result and availability of the separately held offline backups.
No backup paths, contents or recovery credentials are needed. This proves that
workstation loss preserves the signing authority. It does not implement device
recovery, rotate signing, enroll in Play App Signing or authorize distribution.

## Local Qualification

Run the maintained focused suite directly. The SDK scenario uses a copied source
tree and disposable test certificates; it proves the operator/recovery mechanism,
without substituting for the existing production authority's acceptance evidence.
The same opt-in scenario runs in the Android JVM validation job. It simulates
only fixture signing in an isolated operator subprocess; the production helper
continues to reject ordinary hosted-CI signing. No real identity is needed by CI.

Final acceptance still requires the existing DPC/Work public certificate and
public-key digests, role confirmation and DPC Google-registration match, a real
signed candidate verified against that external record, distinction from the
actual Work/debug/ctRegression/local DPC test identities, and the operator's
same-key offline backup/recovery drill evidence. Fixture results satisfy none of
those external evidence requirements. Keep the delivery PR Draft and the issue
open until that evidence and the maintained readiness/merge gates are satisfied.

```bash
SECPAL_DPC_SIGNING_SDK_TESTS=1 bash scripts/with-android-env.sh \
  ./node_modules/.bin/vitest run tests/dpc-production-signing.test.ts
```
