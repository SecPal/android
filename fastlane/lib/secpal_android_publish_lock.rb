# frozen_string_literal: true

require "fileutils"

module SecPalAndroidPublishLock
  class LockError < StandardError; end
  class LockDirectoryError < LockError; end
  class LockUnavailableError < LockError; end

  module_function

  def release_paths(environment: ENV, home_directory: Dir.home)
    configured_directory = environment["SECPAL_ANDROID_CONFIG_DIR"].to_s
    release_directory =
      if configured_directory.empty?
        File.join(home_directory, ".config", "secpal")
      else
        File.expand_path(configured_directory)
      end
    configured_env_file =
      environment["SECPAL_ANDROID_RELEASE_ENV_FILE"].to_s
    release_env_file =
      if configured_env_file.empty?
        File.join(release_directory, "android-release.env")
      else
        File.expand_path(configured_env_file)
      end

    {
      release_env_file: release_env_file,
      publish_lock_file: File.join(
        File.dirname(release_env_file),
        "android-publish.lock"
      )
    }
  end

  def with_lock(path)
    ensure_private_lock_directory!(File.dirname(path))
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

  def ensure_private_lock_directory!(directory)
    FileUtils.mkdir_p(directory, mode: 0o700)
    if File.symlink?(directory)
      raise LockDirectoryError,
            "Refusing symlinked Android publishing lock directory: #{directory}"
    end

    stat = File.stat(directory)
    unless stat.directory?
      raise LockDirectoryError,
            "Android publishing lock path is not a directory: #{directory}"
    end
    if stat.uid != Process.uid
      raise LockDirectoryError,
            "Refusing Android publishing lock directory not owned by the current user: #{directory}"
    end
    if (stat.mode & 0o077) != 0
      raise LockDirectoryError,
            "Refusing Android publishing lock directory with overly permissive permissions: #{directory}"
    end

    directory
  rescue SystemCallError => e
    raise LockDirectoryError,
          "Unable to prepare Android publishing lock directory #{directory}: #{e.message}"
  end
end
