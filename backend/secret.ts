// At-rest encryption for stored credentials: AES-256-GCM with a per-machine
// random key (32 bytes).
//
// Key storage: the OS keychain is used where available — macOS Keychain via
// the `security` CLI, Linux Secret Service via `secret-tool` (D-Bus) — with a
// fallback to a 0600 file (gresui.key) in the config dir when no keychain is
// present (headless Linux, Windows v1, missing CLIs).
//
// Threat model: defends against exposure of the database file alone — backups,
// sync tools, file-indexing daemons, accidental uploads, casual reads. The
// keychain additionally keeps the key out of the config dir, so config-dir
// backups/syncs no longer carry it. It does NOT defend against a same-UID
// attacker on Linux (the Secret Service answers the same user without
// prompting) nor against a live process with the key loaded.
//
// Provider stickiness: the chosen provider is recorded (`security.key_source`
// in gresui.db) once selected. A keychain-backed install never silently mints
// a second key when the keychain is temporarily unavailable — that would make
// every stored password undecryptable when the keychain returns — it fails
// loudly instead. GRESUI_KEY_SOURCE=file|keychain|auto overrides the marker
// (auto = re-detect; used for migration/troubleshooting).
//
// Encrypted values are stored as `enc:v1:<base64(iv || ciphertext)>`; the
// prefix doubles as the legacy-plaintext detector.

import { spawn } from "node:child_process";
import { chmodSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { Buffer } from "node:buffer";

const KEY_NAME = "gresui.key";
const KEY_BYTES = 32;
const IV_BYTES = 12;
export const SECRET_PREFIX = "enc:v1:";

export type KeySource = "keychain" | "file";

const KEYCHAIN_SERVICE = "gresui";
const KEYCHAIN_ACCOUNT = "gresui-key";
const CLI_TIMEOUT_MS = 5_000;

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString("base64");
}

function decodeBase64(s: string): Uint8Array {
  const buf = Buffer.from(s, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// --- keychain CLI helpers ----------------------------------------------------

type CliResult = { ok: boolean; out: string };

/** Run a short CLI; 5s timeout, stdin via pipe for secrets (never argv). */
async function runCli(cmd: string[], input?: string): Promise<CliResult> {
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd[0], cmd.slice(1), {
        stdio: input === undefined
          ? ["ignore", "pipe", "pipe"]
          : ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve({ ok: false, out: "" });
      return;
    }
    let out = "";
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, out: out.trim() });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, CLI_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.on("error", () => finish(false));
    child.on("close", (code: number | null) => finish(code === 0));
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function cliExists(name: string): Promise<boolean> {
  return (await runCli(["sh", "-c", `command -v "${name}"`])).ok;
}

const OS = process.platform;

/** Is a usable OS keychain present right now? */
async function keychainServiceUp(): Promise<boolean> {
  if (OS === "linux") {
    if (!await cliExists("secret-tool")) return false;
    if (await cliExists("gdbus")) {
      return (await runCli([
        "gdbus", "call", "--session",
        "--dest", "org.freedesktop.secrets",
        "--object-path", "/org/freedesktop/secrets",
        "--method", "org.freedesktop.DBus.Peer.Ping",
      ])).ok;
    }
    if (await cliExists("busctl")) {
      return (await runCli(["busctl", "--user", "list"])).out
        .includes("org.freedesktop.secrets");
    }
    return false;
  }
  if (OS === "darwin") return await cliExists("security");
  return false; // Windows: no CLI keychain access in v1 → file key
}

/** Base64 key from the keychain, or null when absent/unavailable. */
async function keychainRead(): Promise<string | null> {
  if (OS === "linux") {
    const r = await runCli([
      "secret-tool", "lookup", "service", KEYCHAIN_SERVICE,
      "account", KEYCHAIN_ACCOUNT,
    ]);
    return r.ok && r.out ? r.out : null;
  }
  if (OS === "darwin") {
    const r = await runCli([
      "security", "find-generic-password", "-s", KEYCHAIN_SERVICE,
      "-a", KEYCHAIN_ACCOUNT, "-w",
    ]);
    return r.ok && r.out ? r.out : null;
  }
  return null;
}

/** Store (or replace) the base64 key in the keychain. */
async function keychainWrite(b64: string): Promise<boolean> {
  if (OS === "linux") {
    return (await runCli([
      "secret-tool", "store", "--label=gresui", "service", KEYCHAIN_SERVICE,
      "account", KEYCHAIN_ACCOUNT,
    ], `${b64}\n`)).ok;
  }
  if (OS === "darwin") {
    // macOS `security` takes -w as argv (visible to same-uid processes for a
    // moment); acceptable v1 — same-UID already reads the file fallback.
    return (await runCli([
      "security", "add-generic-password", "-s", KEYCHAIN_SERVICE,
      "-a", KEYCHAIN_ACCOUNT, "-w", b64, "-U",
    ])).ok;
  }
  return false;
}

// --- key loading -------------------------------------------------------------

/**
 * Load or create the machine key.
 *
 * `source` is the sticky provider (recorded in gresui.db or an env override)
 * or null on first init, where the provider is auto-detected. Returns the
 * imported key plus the provider actually used; the caller persists the
 * provider on first init.
 */
export async function loadKey(
  dir: string,
  source: KeySource | null,
): Promise<{ key: CryptoKey; source: KeySource }> {
  const filePath = `${dir}/${KEY_NAME}`;

  const importRaw = async (raw: Uint8Array, what: string): Promise<CryptoKey> => {
    if (raw.byteLength !== KEY_BYTES) {
      throw new Error(
        `gresui ${what} is corrupt (${raw.byteLength} bytes, expected ${KEY_BYTES})`,
      );
    }
    const keyData = new Uint8Array(raw).buffer;
    return await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  };
  const readFile = async (): Promise<Uint8Array | null> => {
    try {
      return new Uint8Array(await fsp.readFile(filePath));
    } catch {
      return null;
    }
  };
  const writeFile = async (raw: Uint8Array): Promise<void> => {
    await fsp.writeFile(filePath, raw, { mode: 0o600 });
    // Harden perms regardless of how the file got here — a pre-existing file
    // may carry looser modes. Windows: chmod is a no-op-ish; best-effort only.
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // best-effort only
    }
  };
  const freshKey = (): Uint8Array =>
    crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const decodeEntry = (b64: string): Uint8Array => {
    try {
      return decodeBase64(b64);
    } catch {
      throw new Error("gresui keychain entry is corrupt (invalid base64)");
    }
  };
  /** Read the file key, or create it. Never truncate-rewrites an existing
   * healthy key (a crash mid-write would corrupt it); tighten perms only. */
  const loadOrCreateFile = async (): Promise<Uint8Array> => {
    const existing = await readFile();
    if (existing) {
      try {
        chmodSync(filePath, 0o600);
      } catch {
        // best-effort only
      }
      return existing;
    }
    const fresh = freshKey();
    await writeFile(fresh);
    return fresh;
  };

  let raw: Uint8Array;
  let effective: KeySource;

  if (source === "keychain") {
    const b64 = await keychainRead();
    if (!b64) {
      throw new Error(
        `gresui keychain entry is missing (service "${KEYCHAIN_SERVICE}", ` +
        `account "${KEYCHAIN_ACCOUNT}") — stored passwords cannot be decrypted ` +
        "without it. Re-launch in your desktop session, restore the keychain, " +
        "or set GRESUI_KEY_SOURCE=file to force a local key (existing " +
        "passwords will read empty and must be re-entered).",
      );
    }
    raw = decodeEntry(b64);
    effective = "keychain";
  } else if (source === "file") {
    raw = await loadOrCreateFile();
    effective = "file";
  } else {
    // First init: auto-detect the provider.
    if (await keychainServiceUp()) {
      const existing = await keychainRead();
      if (existing) {
        raw = decodeEntry(existing);
        effective = "keychain";
      } else {
        const fileRaw = await readFile();
        if (fileRaw) {
          // File-era install: migrate the key into the keychain, then drop the
          // file so config-dir backups no longer carry it.
          if (await keychainWrite(encodeBase64(fileRaw))) {
            try {
              await fsp.rm(filePath, { force: true });
            } catch {
              // keep the file; harmless duplicate
            }
            effective = "keychain";
          } else {
            try {
              chmodSync(filePath, 0o600);
            } catch {
              // best-effort only
            }
            effective = "file";
          }
          raw = fileRaw;
        } else {
          raw = freshKey();
          if (await keychainWrite(encodeBase64(raw))) {
            effective = "keychain"; // no file ever written
          } else {
            await writeFile(raw);
            effective = "file";
          }
        }
      }
    } else {
      raw = await loadOrCreateFile();
      effective = "file";
    }
  }

  const key = await importRaw(
    raw,
    effective === "keychain" ? "keychain entry" : "gresui.key",
  );
  return { key, source: effective };
}

export async function encryptSecret(plain: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  const out = new Uint8Array(IV_BYTES + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), IV_BYTES);
  return SECRET_PREFIX + encodeBase64(out);
}

/**
 * Decrypt a stored secret. Legacy plaintext (no prefix) passes through.
 * Undecryptable values (lost/rotated key) return "" rather than crashing —
 * the user re-enters the password and the next save re-encrypts it.
 */
export async function decryptSecret(value: string, key: CryptoKey): Promise<string> {
  if (!value.startsWith(SECRET_PREFIX)) return value;
  try {
    const raw = decodeBase64(value.slice(SECRET_PREFIX.length));
    const iv = raw.slice(0, IV_BYTES);
    const ct = raw.slice(IV_BYTES);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return "";
  }
}
