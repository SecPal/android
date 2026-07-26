# frozen_string_literal: true

require "minitest/autorun"
require "etc"
require "tmpdir"
require_relative "../lib/secpal_android_publish_lock"

class SecPalAndroidPublishLockTest < Minitest::Test
  def test_resolves_the_default_release_context
    Dir.mktmpdir do |home_directory|
      paths = SecPalAndroidPublishLock.release_paths(
        environment: {},
        home_directory: home_directory
      )

      expected_directory = File.join(home_directory, ".config", "secpal")
      assert_equal File.join(expected_directory, "android-release.env"),
                   paths.fetch(:release_env_file)
      assert_equal File.join(expected_directory, "android-publish.lock"),
                   paths.fetch(:publish_lock_file)
    end
  end

  def test_resolves_the_configured_release_directory
    Dir.mktmpdir do |home_directory|
      directory = File.join(home_directory, "custom-release")
      paths = SecPalAndroidPublishLock.release_paths(
        environment: {
          "SECPAL_ANDROID_CONFIG_DIR" => directory
        },
        home_directory: home_directory
      )

      assert_equal File.join(directory, "android-release.env"),
                   paths.fetch(:release_env_file)
      assert_equal File.join(
        home_directory,
        ".config",
        "secpal",
        "android-publish.lock"
      ),
                   paths.fetch(:publish_lock_file)
    end
  end

  def test_keeps_the_runner_lock_for_an_explicit_release_env_file
    Dir.mktmpdir do |home_directory|
      config_directory = File.join(home_directory, "ignored-config")
      release_directory = File.join(home_directory, "release-context")
      release_env_file = File.join(release_directory, "custom.env")
      paths = SecPalAndroidPublishLock.release_paths(
        environment: {
          "SECPAL_ANDROID_CONFIG_DIR" => config_directory,
          "SECPAL_ANDROID_RELEASE_ENV_FILE" => release_env_file
        },
        home_directory: home_directory
      )

      assert_equal release_env_file, paths.fetch(:release_env_file)
      assert_equal File.join(
        home_directory,
        ".config",
        "secpal",
        "android-publish.lock"
      ),
                   paths.fetch(:publish_lock_file)
    end
  end

  def test_different_release_contexts_share_one_runner_lock
    Dir.mktmpdir do |home_directory|
      default_paths = SecPalAndroidPublishLock.release_paths(
        environment: {},
        home_directory: home_directory
      )
      custom_paths = SecPalAndroidPublishLock.release_paths(
        environment: {
          "SECPAL_ANDROID_CONFIG_DIR" => File.join(home_directory, "custom"),
          "SECPAL_ANDROID_RELEASE_ENV_FILE" => File.join(
            home_directory,
            "other",
            "release.env"
          )
        },
        home_directory: home_directory
      )

      assert_equal default_paths.fetch(:publish_lock_file),
                   custom_paths.fetch(:publish_lock_file)
    end
  end

  def test_runner_lock_ignores_a_process_home_override
    original_home = ENV["HOME"]
    Dir.mktmpdir do |overridden_home|
      ENV["HOME"] = overridden_home

      paths = SecPalAndroidPublishLock.release_paths(environment: {})
      expected_lock = File.join(
        Etc.getpwuid(Process.uid).dir,
        ".config",
        "secpal",
        "android-publish.lock"
      )

      assert_equal expected_lock, paths.fetch(:publish_lock_file)
    end
  ensure
    ENV["HOME"] = original_home
  end

  def test_creates_a_missing_private_lock_directory
    Dir.mktmpdir do |directory|
      lock_directory = File.join(directory, "custom", "release")
      lock_path = File.join(lock_directory, "android-publish.lock")

      SecPalAndroidPublishLock.with_lock(lock_path) do
        assert_equal 0o700, File.stat(lock_directory).mode & 0o777
      end
    end
  end

  def test_rejects_an_overly_permissive_lock_directory
    Dir.mktmpdir do |directory|
      lock_directory = File.join(directory, "release")
      Dir.mkdir(lock_directory, 0o755)
      lock_path = File.join(lock_directory, "android-publish.lock")

      error = assert_raises(SecPalAndroidPublishLock::LockDirectoryError) do
        SecPalAndroidPublishLock.with_lock(lock_path) { flunk "unsafe lock acquired" }
      end

      assert_includes error.message, "overly permissive"
    end
  end

  def test_rejects_a_symlinked_lock_directory
    Dir.mktmpdir do |directory|
      real_directory = File.join(directory, "real-release")
      lock_directory = File.join(directory, "linked-release")
      Dir.mkdir(real_directory, 0o700)
      File.symlink(real_directory, lock_directory)
      lock_path = File.join(lock_directory, "android-publish.lock")

      error = assert_raises(SecPalAndroidPublishLock::LockDirectoryError) do
        SecPalAndroidPublishLock.with_lock(lock_path) { flunk "unsafe lock acquired" }
      end

      assert_includes error.message, "symlinked"
    end
  end

  def test_acquires_the_publishing_lock
    Dir.mktmpdir do |directory|
      path = File.join(directory, "publish.lock")
      called = false

      SecPalAndroidPublishLock.with_lock(path) { called = true }

      assert called
    end
  end

  def test_rejects_a_second_publishing_process
    Dir.mktmpdir do |directory|
      path = File.join(directory, "publish.lock")
      ready_reader, ready_writer = IO.pipe
      release_reader, release_writer = IO.pipe
      child_pid = fork do
        ready_reader.close
        release_writer.close
        SecPalAndroidPublishLock.with_lock(path) do
          ready_writer.write("1")
          ready_writer.close
          release_reader.read(1)
        end
        exit! 0
      rescue StandardError
        exit! 1
      end
      ready_writer.close
      release_reader.close

      begin
        assert_equal "1", ready_reader.read(1)
        error = assert_raises(SecPalAndroidPublishLock::LockUnavailableError) do
          SecPalAndroidPublishLock.with_lock(path) { flunk "second lock acquired" }
        end

        assert_includes error.message, "already active"
      ensure
        release_writer.write("1")
        release_writer.close
        ready_reader.close
        _waited_pid, child_status = Process.wait2(child_pid)
      end

      assert_predicate child_status, :success?
    end
  end

  def test_releases_the_lock_after_a_publishing_error
    Dir.mktmpdir do |directory|
      path = File.join(directory, "publish.lock")

      assert_raises(RuntimeError) do
        SecPalAndroidPublishLock.with_lock(path) { raise "simulated publish failure" }
      end

      acquired_again = false
      SecPalAndroidPublishLock.with_lock(path) { acquired_again = true }
      assert acquired_again
    end
  end
end
