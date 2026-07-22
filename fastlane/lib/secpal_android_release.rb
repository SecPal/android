# frozen_string_literal: true

require_relative "secpal_android_versioning"

module SecPalAndroidRelease
  class ReleaseError < StandardError; end
  class MissingBuildVersionCodeError < ReleaseError; end
  class MissingPlayCredentialsError < ReleaseError; end
  class SourceReadError < ReleaseError; end

  module_function

  def required_signed_build_version_code!(lane:, environment:)
    value = environment["SECPAL_ANDROID_VERSION_CODE"].to_s.strip
    if value.empty?
      raise MissingBuildVersionCodeError,
            "#{lane} requires an explicit SECPAL_ANDROID_VERSION_CODE in YYYYMMDDXX format; the published baseline is never reused for build-only lanes."
    end

    SecPalAndroidVersioning.validate_current_build_code!(value)
  end

  def require_play_credentials!(lane:, json_key_path:)
    return json_key_path unless json_key_path.to_s.strip.empty?

    raise MissingPlayCredentialsError,
          "#{lane} requires SECPAL_ANDROID_PLAY_JSON_KEY_PATH because every publishing lane must prove the shared sequence against Google Play."
  end

  def collect_known_codes(
    local_baseline:,
    play_tracks:,
    direct_channels:,
    play_reader:,
    direct_reader:
  )
    known_codes = {}
    unless local_baseline.nil? || local_baseline == 0
      known_codes["local release baseline"] = local_baseline
    end

    play_tracks.each do |track|
      codes = play_reader.call(track)
      raise "reader returned no result" if codes.nil?

      Array(codes).each_with_index do |code, index|
        known_codes["Play #{track} ##{index + 1}"] = code
      end
    rescue StandardError => e
      raise SourceReadError,
            "Failed to read required Play #{track} version codes: #{e.message}"
    end

    direct_channels.each do |channel|
      code = direct_reader.call(channel)
      raise "reader returned no result" if code.nil?
      next if code == false

      known_codes["Direct #{channel}"] = code
    rescue StandardError => e
      raise SourceReadError,
            "Failed to read required Direct #{channel} metadata: #{e.message}"
    end

    known_codes
  end
end
