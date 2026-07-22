# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/secpal_android_release"

class SecPalAndroidReleaseTest < Minitest::Test
  def test_signed_apk_requires_an_explicit_current_build_code
    error = assert_raises(SecPalAndroidRelease::MissingBuildVersionCodeError) do
      SecPalAndroidRelease.required_signed_build_version_code!(
        lane: "build_signed_apk",
        environment: {}
      )
    end

    assert_includes error.message, "build_signed_apk"
  end

  def test_signed_aab_requires_an_explicit_current_build_code
    error = assert_raises(SecPalAndroidRelease::MissingBuildVersionCodeError) do
      SecPalAndroidRelease.required_signed_build_version_code!(
        lane: "build_signed_aab",
        environment: {}
      )
    end

    assert_includes error.message, "build_signed_aab"
  end

  def test_signed_build_accepts_a_valid_temporary_code_without_using_the_baseline
    environment = {
      "SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE" => "2026072204",
      "SECPAL_ANDROID_VERSION_CODE" => "2026072208"
    }

    assert_equal 2_026_072_208,
                 SecPalAndroidRelease.required_signed_build_version_code!(
                   lane: "build_signed_apk",
                   environment: environment
                 )
  end

  def test_direct_stable_requires_google_play_credentials
    error = assert_raises(SecPalAndroidRelease::MissingPlayCredentialsError) do
      SecPalAndroidRelease.require_play_credentials!(
        lane: "deploy_direct_apk (stable)",
        json_key_path: nil
      )
    end

    assert_includes error.message, "stable"
  end

  def test_direct_beta_requires_google_play_credentials
    error = assert_raises(SecPalAndroidRelease::MissingPlayCredentialsError) do
      SecPalAndroidRelease.require_play_credentials!(
        lane: "deploy_direct_apk (beta)",
        json_key_path: ""
      )
    end

    assert_includes error.message, "beta"
  end

  def test_fails_closed_when_one_play_track_cannot_be_read
    error = assert_raises(SecPalAndroidRelease::SourceReadError) do
      SecPalAndroidRelease.collect_known_codes(
        local_baseline: 2_026_072_201,
        play_tracks: %w[internal alpha beta production],
        direct_channels: %w[stable beta],
        play_reader: lambda do |track|
          raise "unavailable" if track == "beta"

          [2_026_072_202]
        end,
        direct_reader: ->(_channel) { 2_026_072_203 }
      )
    end

    assert_includes error.message, "Play beta"
  end

  def test_fails_closed_when_a_play_track_returns_no_result
    error = assert_raises(SecPalAndroidRelease::SourceReadError) do
      SecPalAndroidRelease.collect_known_codes(
        local_baseline: 2_026_072_201,
        play_tracks: %w[internal],
        direct_channels: [],
        play_reader: ->(_track) {},
        direct_reader: ->(_channel) {}
      )
    end

    assert_includes error.message, "Play internal"
  end

  def test_fails_closed_when_one_direct_channel_cannot_be_read
    error = assert_raises(SecPalAndroidRelease::SourceReadError) do
      SecPalAndroidRelease.collect_known_codes(
        local_baseline: 2_026_072_201,
        play_tracks: %w[internal alpha beta production],
        direct_channels: %w[stable beta],
        play_reader: ->(_track) { [2_026_072_202] },
        direct_reader: lambda do |channel|
          raise "unavailable" if channel == "stable"

          2_026_072_203
        end
      )
    end

    assert_includes error.message, "Direct stable"
  end

  def test_fails_closed_when_an_available_direct_channel_has_no_code
    error = assert_raises(SecPalAndroidRelease::SourceReadError) do
      SecPalAndroidRelease.collect_known_codes(
        local_baseline: 2_026_072_201,
        play_tracks: [],
        direct_channels: %w[stable],
        play_reader: ->(_track) { [] },
        direct_reader: ->(_channel) {}
      )
    end

    assert_includes error.message, "Direct stable"
  end

  def test_accepts_an_explicitly_unpublished_direct_channel
    known_codes = SecPalAndroidRelease.collect_known_codes(
      local_baseline: 2_026_072_201,
      play_tracks: [],
      direct_channels: %w[beta],
      play_reader: ->(_track) { [] },
      direct_reader: ->(_channel) { false }
    )

    assert_equal({ "local release baseline" => 2_026_072_201 }, known_codes)
  end
end
