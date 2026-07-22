# frozen_string_literal: true

require "date"
require "minitest/autorun"
require_relative "../lib/secpal_android_versioning"

class SecPalAndroidVersioningTest < Minitest::Test
  TODAY = Date.new(2026, 7, 22)

  def test_selects_first_build_of_the_day
    assert_equal 2_026_072_201, next_code({})
  end

  def test_selects_second_build_of_the_same_day
    assert_equal 2_026_072_202, next_code({ "local baseline" => 2_026_072_201 })
  end

  def test_resets_daily_suffix_after_utc_day_change
    assert_equal 2_026_072_201, next_code({ "previous day" => 2_026_072_199 })
  end

  def test_accepts_historical_nine_digit_code_as_a_monotonic_floor
    assert_equal 2_026_072_201, next_code({ "legacy stable" => 261_932_119 })
  end

  def test_uses_stable_when_stable_is_higher_than_beta
    assert_equal 2_026_072_208, next_code({
      "direct stable" => 2_026_072_207,
      "direct beta" => 2_026_072_204
    })
  end

  def test_uses_beta_when_beta_is_higher_than_play
    assert_equal 2_026_072_210, next_code({
      "direct beta" => 2_026_072_209,
      "Play production" => 2_026_072_206
    })
  end

  def test_accepts_a_valid_manual_override
    assert_equal 2_026_072_207, next_code(
      { "direct stable" => 2_026_072_203 },
      override: "2026072207"
    )
  end

  def test_rejects_an_invalid_override_format
    error = assert_raises(SecPalAndroidVersioning::InvalidVersionCodeError) do
      next_code({}, override: "202607221")
    end

    assert_includes error.message, "YYYYMMDDXX"
  end

  def test_rejects_a_non_monotonic_override
    error = assert_raises(SecPalAndroidVersioning::NonMonotonicOverrideError) do
      next_code({ "direct beta" => 2_026_072_207 }, override: "2026072207")
    end

    assert_includes error.message, "direct beta"
  end

  def test_rejects_a_known_future_code
    error = assert_raises(SecPalAndroidVersioning::FutureVersionCodeError) do
      next_code({ "Play internal" => 2_026_072_301 })
    end

    assert_includes error.message, "Play internal"
    assert_includes error.message, "2026072301"
  end

  def test_rejects_more_than_99_builds_per_day
    error = assert_raises(SecPalAndroidVersioning::DailyVersionCodeExhaustedError) do
      next_code({ "local baseline" => 2_026_072_299 })
    end

    assert_includes error.message, "2026072299"
  end

  def test_rejects_an_override_outside_the_requested_utc_day
    assert_raises(SecPalAndroidVersioning::InvalidVersionCodeError) do
      next_code({}, override: "2026072301")
    end
  end

  def test_rejects_dates_that_exceed_google_play_integer_limit
    error = assert_raises(SecPalAndroidVersioning::InvalidVersionCodeError) do
      SecPalAndroidVersioning.next_version_code(
        date: Date.new(2100, 1, 1),
        known_codes: {}
      )
    end

    assert_includes error.message, "Google Play"
  end

  def test_validates_an_explicit_current_build_code
    assert_equal 2_026_072_242,
                 SecPalAndroidVersioning.validate_current_build_code!("2026072242")
  end

  def test_rejects_a_current_build_code_outside_the_supported_years
    error = assert_raises(SecPalAndroidVersioning::InvalidVersionCodeError) do
      SecPalAndroidVersioning.validate_current_build_code!("0000010101")
    end

    assert_includes error.message, "2000 through 2099"
  end

  private

  def next_code(known_codes, override: nil)
    SecPalAndroidVersioning.next_version_code(
      date: TODAY,
      known_codes: known_codes,
      override: override
    )
  end
end
