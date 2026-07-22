# frozen_string_literal: true

require "shellwords"
require "tempfile"
require_relative "secpal_android_versioning"

module SecPalAndroidRelease
  NO_DIRECT_RELEASE = Object.new.freeze

  class ReleaseError < StandardError; end
  class InvalidDirectMetadataError < ReleaseError; end
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

  def direct_version_code_from_metadata(metadata)
    unless metadata.is_a?(Hash)
      raise InvalidDirectMetadataError, "Direct metadata must be a JSON object."
    end

    unless metadata.key?("release_available")
      raise InvalidDirectMetadataError,
            "Direct metadata is missing release_available."
    end
    release_available = metadata["release_available"]
    unless [true, false].include?(release_available)
      raise InvalidDirectMetadataError,
            "Direct metadata release_available must be a boolean."
    end
    return NO_DIRECT_RELEASE unless release_available

    unless metadata.key?("version_code")
      raise InvalidDirectMetadataError,
            "Available Direct metadata is missing version_code."
    end
    version_code = metadata["version_code"]
    SecPalAndroidVersioning.validate_known_version_code!(version_code)
  rescue SecPalAndroidVersioning::VersioningError => e
    raise InvalidDirectMetadataError,
          "Invalid Direct metadata version_code: #{e.message}"
  end

  def persist_last_published_version_code!(path:, version_code:)
    validated_code = SecPalAndroidVersioning.validate_current_build_code!(
      version_code
    )
    replacement = "SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE=#{Shellwords.escape(validated_code.to_s)}"
    found_version_code = false
    lines = File.readlines(path, chomp: true).map do |line|
      if line.strip.match(/\A(?:export\s+)?SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE=/)
        found_version_code = true
        replacement
      else
        line
      end
    end
    lines << replacement unless found_version_code

    stat = File.stat(path)
    directory = File.dirname(path)
    Tempfile.create([".#{File.basename(path)}.", ".tmp"], directory) do |temporary|
      temporary.chmod(stat.mode & 0o777)
      temporary.write("#{lines.join("\n")}\n")
      temporary.flush
      temporary.fsync
      temporary.close
      File.rename(temporary.path, path)
      File.open(directory, File::RDONLY) { |handle| handle.fsync }
    end
  end

  def publish_with_version_code!(environment:, version_code:, persist:)
    assigned = false
    selected = SecPalAndroidVersioning.validate_current_build_code!(version_code)
    environment["SECPAL_ANDROID_VERSION_CODE"] = selected.to_s
    assigned = true
    result = yield selected
    persist.call(selected)
    result
  ensure
    environment&.delete("SECPAL_ANDROID_VERSION_CODE") if assigned
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
        known_codes["Play #{track} ##{index + 1}"] =
          SecPalAndroidVersioning.validate_known_version_code!(code)
      end
    rescue StandardError => e
      raise SourceReadError,
            "Failed to read required Play #{track} version codes: #{e.message}"
    end

    direct_channels.each do |channel|
      code = direct_reader.call(channel)
      raise "reader returned no result" if code.nil?
      next if code.equal?(NO_DIRECT_RELEASE)

      known_codes["Direct #{channel}"] =
        SecPalAndroidVersioning.validate_known_version_code!(code)
    rescue StandardError => e
      raise SourceReadError,
            "Failed to read required Direct #{channel} metadata: #{e.message}"
    end

    known_codes
  end
end
