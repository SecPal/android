# frozen_string_literal: true

module SecPalAndroidPublishLock
  class LockUnavailableError < StandardError; end

  module_function

  def with_lock(path)
    lock_file = File.open(path, File::RDWR | File::CREAT, 0o600)
    acquired = lock_file.flock(File::LOCK_EX | File::LOCK_NB)
    unless acquired
      raise LockUnavailableError,
            "Another Android publishing process is already active (lock: #{path})."
    end

    yield
  ensure
    if lock_file
      lock_file.flock(File::LOCK_UN) if acquired
      lock_file.close
    end
  end
end
