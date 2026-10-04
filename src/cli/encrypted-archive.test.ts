import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENCRYPTED_ARCHIVE_MAGIC, decryptArchive, encryptArchive, isEncryptedArchive } from "../../bin/lib/encrypted-archive.mjs";

const tempDirs: string[] = [];
const fastScrypt = { scryptOptions: { N: 2 ** 10, r: 8, p: 1, maxmem: 32 * 1024 * 1024 } };

function tempDir() {
  const dir = fs.mkdtempSync(join(tmpdir(), "employee001-encrypted-archive-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("encrypted archives", () => {
  it("round trips a file and publishes the expected header", async () => {
    const dir = tempDir();
    const source = join(dir, "source.tar.gz");
    const encrypted = join(dir, "backup.tar.gz.enc");
    const restored = join(dir, "restored.tar.gz");
    const contents = Buffer.from("small private backup\0with bytes", "utf8");
    fs.writeFileSync(source, contents);

    await encryptArchive(source, encrypted, "correct horse battery staple", fastScrypt);
    expect(fs.readFileSync(encrypted).subarray(0, 8)).toEqual(ENCRYPTED_ARCHIVE_MAGIC);
    await decryptArchive(encrypted, restored, "correct horse battery staple", fastScrypt);
    expect(fs.readFileSync(restored)).toEqual(contents);
  });

  it("does not publish output for a wrong passphrase", async () => {
    const dir = tempDir();
    const source = join(dir, "source.tar.gz");
    const encrypted = join(dir, "backup.tar.gz.enc");
    const restored = join(dir, "restored.tar.gz");
    fs.writeFileSync(source, "backup");
    await encryptArchive(source, encrypted, "correct horse battery staple", fastScrypt);

    await expect(decryptArchive(encrypted, restored, "wrong passphrase value", fastScrypt)).rejects.toThrow(/Unable to decrypt archive/);
    expect(fs.existsSync(restored)).toBe(false);
  });

  it("rejects truncated and tampered archives without output", async () => {
    const dir = tempDir();
    const source = join(dir, "source.tar.gz");
    const encrypted = join(dir, "backup.tar.gz.enc");
    fs.writeFileSync(source, "backup with enough bytes to tamper");
    await encryptArchive(source, encrypted, "correct horse battery staple", fastScrypt);

    const truncated = join(dir, "truncated.enc");
    fs.writeFileSync(truncated, fs.readFileSync(encrypted).subarray(0, 20));
    await expect(decryptArchive(truncated, join(dir, "truncated.tar.gz"), "correct horse battery staple", fastScrypt)).rejects.toThrow(/truncated/);

    const tampered = join(dir, "tampered.enc");
    const bytes = fs.readFileSync(encrypted);
    bytes[40] ^= 0x01;
    fs.writeFileSync(tampered, bytes);
    const tamperedOutput = join(dir, "tampered.tar.gz");
    await expect(decryptArchive(tampered, tamperedOutput, "correct horse battery staple", fastScrypt)).rejects.toThrow(/Unable to decrypt archive/);
    expect(fs.existsSync(tamperedOutput)).toBe(false);
  });

  it("detects the magic header without relying on a filename", async () => {
    const dir = tempDir();
    const encrypted = join(dir, "not-an-extension");
    const plain = join(dir, "also-not-an-extension");
    fs.writeFileSync(encrypted, ENCRYPTED_ARCHIVE_MAGIC);
    fs.writeFileSync(plain, "E001ENC0");
    await expect(isEncryptedArchive(encrypted)).resolves.toBe(true);
    await expect(isEncryptedArchive(plain)).resolves.toBe(false);
  });
});
