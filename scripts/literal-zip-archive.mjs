// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { createHash } from "node:crypto";
import yauzl from "yauzl";

export class ZipArchiveReadError extends Error {}

function asArchiveReadError(archivePath, error) {
  return new ZipArchiveReadError(
    `Unable to read ${archivePath}: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

function openZipFile(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      {
        autoClose: false,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(asArchiveReadError(archivePath, error ?? "open failed"));
          return;
        }
        resolve(zipFile);
      }
    );
  });
}

function collectEntries(archivePath, zipFile) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const handleError = (error) => {
      reject(asArchiveReadError(archivePath, error));
    };
    zipFile.once("error", handleError);
    zipFile.on("entry", (entry) => {
      entries.push(entry);
      zipFile.readEntry();
    });
    zipFile.once("end", () => {
      zipFile.removeListener("error", handleError);
      resolve(entries);
    });
    zipFile.readEntry();
  });
}

function consumeEntry(archivePath, zipFile, entry, consumeChunk) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, readStream) => {
      if (error || !readStream) {
        reject(asArchiveReadError(archivePath, error ?? "entry open failed"));
        return;
      }
      readStream.on("data", consumeChunk);
      readStream.once("error", (streamError) => {
        reject(asArchiveReadError(archivePath, streamError));
      });
      readStream.once("end", resolve);
    });
  });
}

export async function openLiteralZipArchive(archivePath) {
  const zipFile = await openZipFile(archivePath);
  let entries;
  try {
    entries = await collectEntries(archivePath, zipFile);
  } catch (error) {
    zipFile.close();
    throw error;
  }

  const entriesByName = new Map();
  for (const entry of entries) {
    const matchingEntries = entriesByName.get(entry.fileName) ?? [];
    matchingEntries.push(entry);
    entriesByName.set(entry.fileName, matchingEntries);
  }
  const selectEntry = (entryName) => {
    const matchingEntries = entriesByName.get(entryName) ?? [];
    if (matchingEntries.length !== 1) {
      throw asArchiveReadError(
        archivePath,
        `expected exactly one literal entry ${entryName}`
      );
    }
    return matchingEntries[0];
  };

  return {
    entries: entries.map(({ fileName }) => fileName),
    async hashEntry(entryName) {
      const digest = createHash("sha256");
      await consumeEntry(
        archivePath,
        zipFile,
        selectEntry(entryName),
        (chunk) => digest.update(chunk)
      );
      return digest.digest("hex");
    },
    async readEntry(entryName) {
      const chunks = [];
      await consumeEntry(
        archivePath,
        zipFile,
        selectEntry(entryName),
        (chunk) => chunks.push(Buffer.from(chunk))
      );
      return Buffer.concat(chunks);
    },
    close() {
      zipFile.close();
    },
  };
}
