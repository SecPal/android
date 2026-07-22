# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
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

  def test_explicit_environment_baseline_wins_over_the_persisted_file_value
    resolved = SecPalAndroidRelease.resolve_last_published_version_code(
      environment: {
        "SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE" => "2026072205"
      },
      persisted_value: "2026072201",
      legacy_value: nil
    )

    assert_equal "2026072205", resolved
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
    unavailable = SecPalAndroidRelease.direct_version_code_from_metadata(
      "release_available" => false
    )
    known_codes = SecPalAndroidRelease.collect_known_codes(
      local_baseline: 2_026_072_201,
      play_tracks: [],
      direct_channels: %w[beta],
      play_reader: ->(_track) { [] },
      direct_reader: ->(_channel) { unavailable }
    )

    assert_equal({ "local release baseline" => 2_026_072_201 }, known_codes)
  end

  def test_fails_closed_when_available_direct_metadata_contains_false_version_code
    error = assert_raises(SecPalAndroidRelease::InvalidDirectMetadataError) do
      SecPalAndroidRelease.direct_version_code_from_metadata(
        "release_available" => true,
        "version_code" => false
      )
    end

    assert_includes error.message, "version_code"
  end

  def test_fails_closed_when_a_direct_reader_returns_false_as_a_version_code
    error = assert_raises(SecPalAndroidRelease::SourceReadError) do
      SecPalAndroidRelease.collect_known_codes(
        local_baseline: 2_026_072_201,
        play_tracks: [],
        direct_channels: %w[stable],
        play_reader: ->(_track) { [] },
        direct_reader: ->(_channel) { false }
      )
    end

    assert_includes error.message, "Direct stable"
  end

  def test_persists_the_release_baseline_atomically_and_preserves_permissions
    Dir.mktmpdir do |directory|
      path = File.join(directory, "android-release.env")
      File.write(path, "SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE=2026072201\n")
      File.chmod(0o600, path)

      SecPalAndroidRelease.persist_last_published_version_code!(
        path: path,
        version_code: 2_026_072_202
      )

      assert_equal "SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE=2026072202\n",
                   File.read(path)
      assert_equal 0o600, File.stat(path).mode & 0o777
      assert_equal ["android-release.env"], Dir.children(directory)
    end
  end

  def test_keeps_the_existing_baseline_when_atomic_replacement_fails
    Dir.mktmpdir do |directory|
      path = File.join(directory, "android-release.env")
      original = "SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE=2026072201\n"
      File.write(path, original)
      File.chmod(0o600, path)

      File.stub(:rename, ->(*) { raise IOError, "simulated rename failure" }) do
        assert_raises(IOError) do
          SecPalAndroidRelease.persist_last_published_version_code!(
            path: path,
            version_code: 2_026_072_202
          )
        end
      end

      assert_equal original, File.read(path)
      assert_equal ["android-release.env"], Dir.children(directory)
    end
  end

  def test_persists_only_after_successful_publication_and_clears_the_build_code
    environment = {}
    events = []

    result = SecPalAndroidRelease.publish_with_version_code!(
      environment: environment,
      version_code: 2_026_072_202,
      persist: ->(code) { events << [:persist, code] }
    ) do |code|
      assert_equal "2026072202", environment["SECPAL_ANDROID_VERSION_CODE"]
      events << [:publish, code]
      :uploaded
    end

    assert_equal :uploaded, result
    assert_equal [
      [:publish, 2_026_072_202],
      [:persist, 2_026_072_202]
    ], events
    refute environment.key?("SECPAL_ANDROID_VERSION_CODE")
  end

  def test_does_not_persist_after_failed_publication_and_clears_the_build_code
    environment = {}
    persisted = false

    error = assert_raises(RuntimeError) do
      SecPalAndroidRelease.publish_with_version_code!(
        environment: environment,
        version_code: 2_026_072_202,
        persist: ->(_code) { persisted = true }
      ) do
        raise "simulated upload failure"
      end
    end

    assert_equal "simulated upload failure", error.message
    refute persisted
    refute environment.key?("SECPAL_ANDROID_VERSION_CODE")
  end
end
