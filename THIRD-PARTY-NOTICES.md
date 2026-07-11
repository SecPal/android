<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Third-Party Notices

This notice records third-party material committed to this repository. It does
not relicense that material. Dependency inventories are maintained separately
in `package-lock.json` and the Gradle resolution reports described in
[docs/THIRD_PARTY_LICENSE_AUDIT.md](docs/THIRD_PARTY_LICENSE_AUDIT.md).

## Gradle Wrapper

`android/gradlew`, `android/gradlew.bat`, and
`android/gradle/wrapper/gradle-wrapper.jar` are generated Gradle Wrapper
material. The scripts retain their upstream copyright notices:

```text
Copyright © 2015-2021 the original authors.
Copyright 2015 the original author or authors.
```

The Wrapper is licensed under Apache-2.0. Its JAR embeds `META-INF/LICENSE`;
the complete license text is also available at
[LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).

## Capacitor Android templates and generated files

The committed Capacitor-generated Gradle files and unchanged template files
listed in `REUSE.toml` originate from `@capacitor/cli` and are licensed under
the MIT License:

```text
Copyright (c) 2017-present Drifty Co.
```

SecPal's normalization of the generated Cordova Gradle project is an AGPLv3
change with the SecPal attribution terms. Its `.license` sidecar and
`REUSE.toml` aggregate that SecPal provenance with the upstream Drifty/MIT
provenance; unchanged Capacitor output remains MIT only. The complete MIT text
is at [LICENSES/MIT.txt](LICENSES/MIT.txt).

## Dependencies and shipped notices

npm dependencies are package-managed third-party software, not copied source;
their exact resolved inventory is `package-lock.json`. Android/Maven artifacts
are likewise resolved at build time and are not vendored in this repository.
The audit records the reproduction commands and current inventory in
[docs/THIRD_PARTY_LICENSE_AUDIT.md](docs/THIRD_PARTY_LICENSE_AUDIT.md).

Release APK/AAB builds still need a user-accessible OSS-notices surface for
their resolved Google Play services and Firebase graph. That release-artifact
work is tracked in [#334](https://github.com/SecPal/android/issues/334).
