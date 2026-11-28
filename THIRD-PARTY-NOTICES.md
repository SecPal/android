<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Third-Party Notices

This notice records the provenance of committed third-party material and
links to the dependency inventories and notices shipped with the app.

## Gradle Wrapper

`android/gradlew`, `android/gradlew.bat`, and
`android/gradle/wrapper/gradle-wrapper.jar` are generated Gradle Wrapper
material. The scripts retain their upstream copyright notices:

```text
Copyright © 2015-2021 the original authors.
Copyright 2015 the original author or authors.
```

The Wrapper uses [Gradle's Apache-2.0 license](https://docs.gradle.org/current/userguide/licenses.html).
Its JAR embeds `META-INF/LICENSE`;
the complete license text is also available at
[LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).

## Capacitor Android templates and generated files

The committed Capacitor-generated Gradle files and unchanged template files
listed in `REUSE.toml` originate from `@capacitor/cli` and are licensed under
the MIT License:

```text
Copyright (c) 2017-present Drifty Co.
```

SecPal's normalization of the generated Cordova Gradle project is an
AGPL-3.0-or-later change. Its `.license` sidecar and
`REUSE.toml` aggregate that SecPal provenance with the upstream Drifty/MIT
provenance; unchanged Capacitor output remains MIT only. The complete MIT text
is at [LICENSES/MIT.txt](LICENSES/MIT.txt).

## GitHub Android ignore template

`android/.gitignore` is based on the
[GitHub Android ignore template](https://github.com/github/gitignore/blob/HEAD/Android.gitignore),
which is CC0-1.0. Its local SecPal additions use a separate AGPLv3 sidecar, so
the upstream template provenance and local changes remain distinct. The
complete CC0 text is at [LICENSES/CC0-1.0.txt](LICENSES/CC0-1.0.txt).

## Dependencies and shipped notices

The [npm lockfile](package-lock.json), [Bundler lockfile](Gemfile.lock), and
Gradle release runtime locks for the [app](android/app/gradle.lockfile) and
[DPC](android/dpc/gradle.lockfile) record resolved dependencies. For the
native runtime graph, run Gradle from `android/`:

```sh
./gradlew :app:dependencies --configuration releaseRuntimeClasspath
./gradlew :dpc:dependencies --configuration releaseRuntimeClasspath
```

The app packages generated native OSS notices for its release runtime,
including its Google Play services and Firebase dependencies. The app opens
the native notices screen from [the completed #334 integration](https://github.com/SecPal/android/issues/334).
The [OSS notices verifier](scripts/verify-android-oss-licenses.sh) checks the
resolved app graph and the generated APK and AAB notice resources.

The packaged frontend carries its own
[dependency notices](android/app/src/main/assets/public/THIRD-PARTY-DEPENDENCY-NOTICES.md),
[third-party source notices](android/app/src/main/assets/public/THIRD-PARTY-NOTICES.md),
and [SPDX dependency inventory](android/app/src/main/assets/public/dependencies.spdx.json)
from the pinned frontend artifact.
