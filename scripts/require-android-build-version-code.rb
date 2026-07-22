#!/usr/bin/env ruby
# frozen_string_literal: true

# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

require_relative "../fastlane/lib/secpal_android_release"

lane = ARGV.shift.to_s.strip
abort "Missing signed-build command name." if lane.empty?
abort "Missing signed-build command." if ARGV.empty?

begin
  SecPalAndroidRelease.required_signed_build_version_code!(
    lane: lane,
    environment: ENV
  )
rescue SecPalAndroidRelease::ReleaseError,
       SecPalAndroidVersioning::VersioningError => e
  warn e.message
  exit 1
end

exec(*ARGV)
