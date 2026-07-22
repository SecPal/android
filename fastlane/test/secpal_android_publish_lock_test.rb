# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
require_relative "../lib/secpal_android_publish_lock"

class SecPalAndroidPublishLockTest < Minitest::Test
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
      child_status = nil

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
