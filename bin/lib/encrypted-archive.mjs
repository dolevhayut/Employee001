import { appendFile, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { randomBytes, scrypt as scryptCallback, createCipheriv, createDecipheriv } from "node:crypto";
import { dirname, basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

export const ENCRYPTED_ARCHIVE_MAGIC = Buffer.from("E001ENC1", "ascii");
export const ENCRYPTED_ARCHIVE_VERSION = 1;

const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER_LENGTH = ENCRYPTED_ARCHIVE_MAGIC.length + 1 + SALT_LENGTH + NONCE_LENGTH;
const DEFAULT_SCRYPT_OPTIONS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
};
const scrypt = promisify(scryptCallback);

function temporaryPath(outputPath) {
  return join(dirname(outputPath), `.${basename(outputPath)}.${randomBytes(12).toString("hex")}.tmp`);
}

async function deriveKey(passphrase, salt, scryptOptions) {
  return scrypt(passphrase, salt, 32, { ...DEFAULT_SCRYPT_OPTIONS, ...scryptOptions });
}

async function readHeader(archivePath) {
  const handle = await open(archivePath, "r");
  try {
    const header = Buffer.alloc(HEADER_LENGTH);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < HEADER_LENGTH) throw new Error("Encrypted archive is truncated.");
    if (!header.subarray(0, ENCRYPTED_ARCHIVE_MAGIC.length).equals(ENCRYPTED_ARCHIVE_MAGIC)) {
      throw new Error("Not an Employee001 encrypted archive.");
    }
    if (header[ENCRYPTED_ARCHIVE_MAGIC.length] !== ENCRYPTED_ARCHIVE_VERSION) {
      throw new Error(`Unsupported encrypted archive version: ${header[ENCRYPTED_ARCHIVE_MAGIC.length]}.`);
    }
    return {
      salt: header.subarray(9, 9 + SALT_LENGTH),
      nonce: header.subarray(9 + SALT_LENGTH, HEADER_LENGTH),
    };
  } finally {
    await handle.close();
  }
}

/** Returns true when a file begins with the Employee001 encrypted-archive magic. */
export async function isEncryptedArchive(archivePath) {
  try {
    const handle = await open(archivePath, "r");
    try {
      const magic = Buffer.alloc(ENCRYPTED_ARCHIVE_MAGIC.length);
      const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
      return bytesRead === magic.length && magic.equals(ENCRYPTED_ARCHIVE_MAGIC);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/**
 * Stream an archive through AES-256-GCM and atomically publish it on success.
 */
export async function encryptArchive(inputPath, outputPath, passphrase, { scryptOptions } = {}) {
  const salt = randomBytes(SALT_LENGTH);
  const nonce = randomBytes(NONCE_LENGTH);
  const key = await deriveKey(passphrase, salt, scryptOptions);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: AUTH_TAG_LENGTH });
  const temporaryOutput = temporaryPath(outputPath);
  const header = Buffer.concat([
    ENCRYPTED_ARCHIVE_MAGIC,
    Buffer.from([ENCRYPTED_ARCHIVE_VERSION]),
    salt,
    nonce,
  ]);

  try {
    await writeFile(temporaryOutput, header, { flag: "wx" });
    await pipeline(createReadStream(inputPath), cipher, createWriteStream(temporaryOutput, { flags: "a" }));
    await appendFile(temporaryOutput, cipher.getAuthTag());
    await rename(temporaryOutput, outputPath);
  } catch (error) {
    await rm(temporaryOutput, { force: true });
    throw error;
  }
}

/**
 * Verify and decrypt an encrypted archive. The output path is not published
 * unless GCM authentication succeeds.
 */
export async function decryptArchive(inputPath, outputPath, passphrase, { scryptOptions } = {}) {
  const { size } = await stat(inputPath);
  if (size < HEADER_LENGTH + AUTH_TAG_LENGTH) throw new Error("Encrypted archive is truncated.");

  const { salt, nonce } = await readHeader(inputPath);
  const key = await deriveKey(passphrase, salt, scryptOptions);
  const tagOffset = size - AUTH_TAG_LENGTH;
  const tagHandle = await open(inputPath, "r");
  let authTag;
  try {
    authTag = Buffer.alloc(AUTH_TAG_LENGTH);
    const { bytesRead } = await tagHandle.read(authTag, 0, AUTH_TAG_LENGTH, tagOffset);
    if (bytesRead !== AUTH_TAG_LENGTH) throw new Error("Encrypted archive is truncated.");
  } finally {
    await tagHandle.close();
  }

  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const temporaryOutput = temporaryPath(outputPath);

  try {
    await pipeline(
      createReadStream(inputPath, { start: HEADER_LENGTH, end: tagOffset - 1 }),
      decipher,
      createWriteStream(temporaryOutput, { flags: "wx" }),
    );
    await rename(temporaryOutput, outputPath);
  } catch (error) {
    await rm(temporaryOutput, { force: true });
    throw new Error("Unable to decrypt archive: passphrase is incorrect or archive was corrupted.", { cause: error });
  }
}
