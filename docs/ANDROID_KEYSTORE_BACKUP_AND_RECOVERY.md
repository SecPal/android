<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Android Keystore Backup And Recovery

This document defines the minimum operational standard for the SecPal Android upload key on Fedora and Qubes OS.

## Goal

The Android upload key must be:

- kept outside the repository
- recoverable after workstation loss
- available for both direct APK distribution and Google Play releases
- protected against accidental disclosure inside a developer AppVM

## Current Local Paths

The repository-local scripts use these default paths:

- keystore: `~/.config/secpal/android-upload.jks`
- release env file: `~/.config/secpal/android-release.env`

Both files are created with mode `600`.

## Recommended Qubes Layout

On Qubes OS, do not treat the Android upload key as disposable AppVM state.

Recommended layout:

- daily Android development in a regular AppVM
- long-term encrypted backup stored outside the working AppVM
- one offline or strongly controlled backup copy in a dedicated vault-like location

Minimum recommendation:

1. keep the working copy in the Android development AppVM under `~/.config/secpal/`
2. export an encrypted backup into a non-disposable, trusted backup location
3. store a second recovery copy offline or in a separate protected vault

## What Must Be Backed Up

You need both files together:

- `android-upload.jks`
- `android-release.env`

The keystore alone is not sufficient, because the environment file contains the alias and passwords used by the build scripts.

## Backup Procedure

Create a backup directory first:

```bash
mkdir -p "$HOME/Documents/secpal-android-keystore-backup"
chmod 700 "$HOME/Documents/secpal-android-keystore-backup"
```

Create an encrypted archive:

```bash
cd "$HOME/.config"
tar -czf - secpal \
  | gpg --symmetric --cipher-algo AES256 \
  --output "$HOME/Documents/secpal-android-keystore-backup/secpal-android-keystore-$(date +%F).tar.gz.gpg"
```

Then move or copy that encrypted archive to your intended backup target.

## Recovery Procedure

To restore on a fresh Fedora/Qubes environment:

```bash
mkdir -p "$HOME/.config"
gpg --decrypt "$HOME/Documents/secpal-android-keystore-backup/secpal-android-keystore-YYYY-MM-DD.tar.gz.gpg" \
  | tar -xzf - -C "$HOME/.config"
chmod 700 "$HOME/.config/secpal"
chmod 600 "$HOME/.config/secpal/android-upload.jks"
chmod 600 "$HOME/.config/secpal/android-release.env"
```

Validate the restored setup:

```bash
cd /home/user/code/SecPal/android
npm run native:assemble:release:signed
npm run native:bundle:release:signed
```

## Rotation Policy

Do not rotate the upload key casually.

Changing the upload key has consequences for:

- direct APK upgrades
- DPC rollouts using the same app identity
- Play Console upload configuration

Recommended rule:

- keep one stable upload key from first real release onward
- rotate only if compromise is suspected or if Play Console operational policy requires it

## Google Play App Signing Recommendation

For the current SecPal plan, the recommended model is:

1. keep one stable local upload key under `~/.config/secpal/`
2. enroll in Google Play App Signing when the Play Console is ready
3. continue uploading with the same local upload key unless there is a clear reason to rotate it later

This keeps direct distribution and Play distribution aligned while still letting Google manage the final app-signing key inside Play.
