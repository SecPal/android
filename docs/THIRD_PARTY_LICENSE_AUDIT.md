<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Third-Party License Audit

Audit date: 2026-07-11. Scope: locked npm dependencies, Android release
runtime dependencies, build tooling, committed third-party templates, and
REUSE metadata. This audit does not relicense any dependency or alter the
separate SecPal attribution terms work in issue #313.

## REUSE and committed files

`reuse lint` reports that all 267 tracked files have copyright and license
information. `LICENSES/` contains the texts for every identifier REUSE uses:
`AGPL-3.0-or-later`, `Apache-2.0`, `CC0-1.0`, `MIT`, and
`LicenseRef-SecPal-Attribution`.

The audit corrected the attribution of the Gradle Wrapper files. `gradlew` and
`gradlew.bat` retain their upstream copyright notices and Apache-2.0 headers;
the wrapper JAR embeds `META-INF/LICENSE`. They must not be attributed to
SecPal Contributors. Gradle licenses its Build Tool under Apache-2.0 in its
[licensing documentation](https://docs.gradle.org/current/userguide/licenses.html);
the checked-in wrapper JAR is self-attributing through its embedded license.

The committed Capacitor-generated files originate from the `@capacitor/cli`
package and retain its `2017-present Drifty Co.` MIT provenance. The repository
normalizes `android/capacitor-cordova-android-plugins/build.gradle`; its
sidecar records that local change under AGPLv3 with the SecPal attribution
terms, alongside the upstream MIT provenance. Unmodified Android template
files remain MIT only. No Tailwind-derived material, copied third-party
snippets, or replaced third-party notices were found outside the Gradle Wrapper,
Capacitor template, and GitHub Android ignore-template provenance above.

`android/.gitignore` retains the upstream GitHub Android ignore template's CC0
provenance. Its local SecPal rules are recorded separately in an AGPLv3
sidecar, so neither source is relicensed by the other.

`LicenseRef-SecPal-Attribution` is used only with the existing SecPal-owned
AGPL material. This audit neither adds it to third-party material nor changes
the attribution-terms scope.

The concise provenance record for committed third-party material is in
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md). It intentionally separates
copied/generated source provenance from the lockfile dependency inventories.

## npm inventory

The production dependency graph locked by `package-lock.json` contains four
packages:

| Package              | Version | License                                                                                                                 |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@capacitor/android` | 8.4.1   | MIT                                                                                                                     |
| `@capacitor/core`    | 8.4.1   | MIT                                                                                                                     |
| `tslib`              | 2.8.1   | 0BSD                                                                                                                    |
| `@secpal/android`    | 0.0.1   | private package; `license-checker` reports `UNLICENSED`, while `package.json` declares the repository's AGPL expression |

The full development graph has 293 packages. Its license-checker result is:
232 MIT; 15 ISC; 15 Apache-2.0; 10 BlueOak-1.0.0; 7 BSD-2-Clause; 6
BSD-3-Clause; 3 MPL-2.0; and one each of 0BSD, Python-2.0, Unlicense, and a
BSD-2-Clause/MIT/Apache-2.0 choice. Build-only packages are not conveyed in
the Android APK. MIT, BSD, ISC, Apache-2.0, BlueOak, MPL-2.0, 0BSD, and
Python-2.0 notices remain in the package-manager artifacts; no project-owned
license text is substituted for them. The root package's npm `UNLICENSED`
inventory entry is expected for a private package and does not override the
repository's `package.json` license expression.

Reproduce with:

```sh
npm ci --ignore-scripts
npx --yes license-checker-rseidelsohn@5.0.1 --production --json
npx --yes license-checker-rseidelsohn@5.0.1 --json
```

## Android/Gradle inventory and distribution obligations

`./gradlew :app:dependencies --configuration releaseRuntimeClasspath` resolved
the app's direct runtime roots as Firebase BoM 34.12.0, Firebase Common
22.0.1, Firebase Messaging 25.0.1, AndroidX Activity 1.9.2, AppCompat 1.7.0,
CoordinatorLayout 1.2.0, Credentials and Credentials Play Services Auth 1.5.0,
Core Splashscreen 1.0.1, AndroidX WebKit 1.12.1, Capacitor Android, and the
generated Capacitor Cordova project. Their transitive graph includes AndroidX,
Kotlin, Google Play services, Firebase, and Apache Cordova components. The
Android Gradle Plugin and its transitive graph are build-only.

The repository does not vendor Maven artifacts, so their license texts do not
belong in `LICENSES/`; `LICENSES/` is for the repository's own SPDX-marked
files. The release distribution must nevertheless carry the notices required
by the libraries it compiles. Google documents that app developers are
responsible for displaying notices for open-source libraries used by Google
Play services and provides the OSS licenses Gradle plugin and runtime activity
for doing so ([official guidance](https://developers.google.com/android/guides/opensource)).

No source-offer obligation was identified for the package-manager dependencies
from this audit. The remaining release obligation is to add and expose the
Google Play services OSS notices mechanism, then verify its generated notices
against the release APK/AAB dependency graph. That implementation is tracked
in [#334](https://github.com/SecPal/android/issues/334) so this metadata-only
audit does not add a runtime dependency or UI.

Reproduce the runtime and build-time graphs with:

```sh
cd android
./gradlew :app:dependencies --configuration releaseRuntimeClasspath
./gradlew buildEnvironment
./gradlew :capacitor-cordova-android-plugins:buildEnvironment
```

## Validation

The metadata change is validated with `reuse lint`. The follow-up issue is
limited to generated Android OSS notices and a user-accessible notices surface;
it does not authorize relicensing third-party code.
