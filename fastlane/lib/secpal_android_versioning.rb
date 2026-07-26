# frozen_string_literal: true

require "date"

module SecPalAndroidVersioning
  GOOGLE_PLAY_MAX_VERSION_CODE = 2_100_000_000
  VERSION_CODE_PATTERN = /\A(\d{4})(\d{2})(\d{2})(\d{2})\z/

  class VersioningError < StandardError; end
  class InvalidVersionCodeError < VersioningError; end
  class NonMonotonicOverrideError < VersioningError; end
  class FutureVersionCodeError < VersioningError; end
  class DailyVersionCodeExhaustedError < VersioningError; end

  module_function

  def next_version_code(date:, known_codes:, override: nil)
    unless date.is_a?(Date)
      raise ArgumentError, "date must be a UTC Date"
    end

    daily_minimum, daily_maximum = daily_range(date)
    parsed_known_codes = known_codes.to_h.transform_values do |value|
      validate_known_version_code!(value)
    end
    highest_source, highest_code = parsed_known_codes.max_by { |_source, code| code }
    highest_code ||= 0

    if highest_code > daily_maximum
      raise FutureVersionCodeError,
            "Known version code #{highest_code} from #{highest_source} is above today's UTC range ending at #{daily_maximum}; check clock, future release data, and configuration drift."
    end

    unless override.to_s.strip.empty?
      selected = validate_current_build_code!(override)
      unless selected.between?(daily_minimum, daily_maximum)
        raise InvalidVersionCodeError,
              "Manual override #{selected} must be inside today's UTC range #{daily_minimum}..#{daily_maximum}."
      end
      if selected <= highest_code
        raise NonMonotonicOverrideError,
              "Manual override #{selected} must be greater than known version code #{highest_code} from #{highest_source}."
      end

      return selected
    end

    return daily_minimum if highest_code < daily_minimum

    if highest_code == daily_maximum
      raise DailyVersionCodeExhaustedError,
            "UTC build range is exhausted because #{daily_maximum} is already known; wait for the next UTC day."
    end

    highest_code + 1
  end

  def validate_current_build_code!(value)
    string_value = value.to_s.strip
    match = VERSION_CODE_PATTERN.match(string_value)
    unless match
      raise InvalidVersionCodeError,
            "Invalid version code #{value.inspect}; expected YYYYMMDDXX with XX from 01 through 99."
    end

    year, month, day, sequence = match.captures.map(&:to_i)
    unless year.between?(2000, 2099)
      raise InvalidVersionCodeError,
            "Invalid version code #{string_value}: YYYY must be from 2000 through 2099."
    end
    begin
      Date.new(year, month, day)
    rescue Date::Error
      raise InvalidVersionCodeError,
            "Invalid version code #{string_value}: YYYYMMDD is not a calendar date."
    end

    unless sequence.between?(1, 99)
      raise InvalidVersionCodeError,
            "Invalid version code #{string_value}: XX must be from 01 through 99."
    end

    parsed = Integer(string_value, 10)
    if parsed > GOOGLE_PLAY_MAX_VERSION_CODE
      raise InvalidVersionCodeError,
            "Version code #{parsed} exceeds the Google Play maximum #{GOOGLE_PLAY_MAX_VERSION_CODE}."
    end

    parsed
  end

  def validate_known_version_code!(value)
    string_value = value.to_s.strip
    unless string_value.match?(/\A\d+\z/)
      raise InvalidVersionCodeError,
            "Known version code #{value.inspect} must be a positive decimal integer."
    end

    parsed = Integer(string_value, 10)
    if parsed <= 0 || parsed > GOOGLE_PLAY_MAX_VERSION_CODE
      raise InvalidVersionCodeError,
            "Known version code #{parsed} must be between 1 and #{GOOGLE_PLAY_MAX_VERSION_CODE}."
    end

    validate_current_build_code!(string_value) if string_value.length >= 10
    parsed
  end

  def daily_range(date)
    prefix = date.strftime("%Y%m%d")
    minimum = Integer("#{prefix}01", 10)
    maximum = Integer("#{prefix}99", 10)
    if maximum > GOOGLE_PLAY_MAX_VERSION_CODE
      raise InvalidVersionCodeError,
            "UTC date #{date} produces version codes above the Google Play maximum #{GOOGLE_PLAY_MAX_VERSION_CODE}."
    end

    [minimum, maximum]
  end
  private_class_method :daily_range
end
