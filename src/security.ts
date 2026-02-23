import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Paths that must never be used as a workspace root.
// Defense-in-depth: prevents a misconfigured or malicious MCP client config
// from pointing the daemon at system directories or user credential stores.
const RESTRICTED_WORKSPACE_ROOTS: ReadonlySet<string> = new Set([
  // Filesystem root
  "/",
  // Core system directories
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
  // User credential directories
  path.join(os.homedir(), ".aws"),
  path.join(os.homedir(), ".azure"),
  path.join(os.homedir(), ".gnupg"),
  path.join(os.homedir(), ".kube"),
  path.join(os.homedir(), ".ssh"),
]);

/**
 * File basenames that always indicate sensitive content regardless of location.
 * Matched case-insensitively against the file's basename.
 */
const SENSITIVE_BASENAME_EXACT = new Set([
  "credentials",
  ".credentials",
  "known_hosts",
  "authorized_keys",
  "id_rsa",
  "id_ecdsa",
  "id_ed25519",
  "id_dsa",
]);

/**
 * File extensions that indicate sensitive content (private keys, certificates,
 * keystores). Matched against the full extension, lowercased.
 */
const SENSITIVE_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".cert",
  ".crt",
]);

/**
 * Returns true if the file at `filePath` should never have its content read
 * or returned by search/replace operations.
 *
 * Checked against: exact basenames (SSH keys, credential files), file
 * extensions (PEM, p12, keystore, cert), and .env prefix patterns.
 */
export function isSensitiveFile(filePath: string): boolean {
  const base = path.basename(filePath);
  const baseLower = base.toLowerCase();
  const ext = path.extname(base).toLowerCase();

  if (SENSITIVE_EXTENSIONS.has(ext)) return true;
  if (SENSITIVE_BASENAME_EXACT.has(baseLower)) return true;

  // .env, .env.local, .env.production, etc. — basename starts with ".env"
  // followed by end-of-string, a dot, or an underscore.
  if (/^\.env($|\.|_)/i.test(base)) return true;

  return false;
}

export function validateWorkspace(
  workspacePath: string,
): { ok: true; workspace: string } | { ok: false; error: string } {
  const absWorkspace = path.resolve(workspacePath);

  if (!fs.existsSync(absWorkspace)) {
    return { ok: false, error: `Workspace directory not found: ${workspacePath}` };
  }

  if (!fs.statSync(absWorkspace).isDirectory()) {
    return { ok: false, error: `Workspace is not a directory: ${workspacePath}` };
  }

  if (RESTRICTED_WORKSPACE_ROOTS.has(absWorkspace)) {
    return { ok: false, error: `Workspace is a restricted system path: ${workspacePath}` };
  }

  // Also resolve symlinks — catches a symlink from an innocuous path into a
  // restricted directory (e.g. /projects/link → /etc).
  try {
    const real = fs.realpathSync(absWorkspace);
    if (RESTRICTED_WORKSPACE_ROOTS.has(real)) {
      return {
        ok: false,
        error: `Workspace resolves to a restricted system path: ${workspacePath}`,
      };
    }
  } catch {
    return { ok: false, error: `Could not resolve workspace path: ${workspacePath}` };
  }

  return { ok: true, workspace: absWorkspace };
}

export function isWithinWorkspace(filePath: string, workspace: string): boolean {
  const abs = path.resolve(filePath);
  const rel = path.relative(workspace, abs);
  if (rel.startsWith("..")) return false;
  // For existing paths, also check the real path to catch symlink escapes.
  if (fs.existsSync(abs)) {
    try {
      const real = fs.realpathSync(abs);
      if (path.relative(workspace, real).startsWith("..")) return false;
    } catch {
      return false;
    }
  }
  return true;
}
