import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Validates a file path string for control characters and URI fragments.
 * Must be called before path.resolve() or path.normalize() — those calls
 * are exactly what we're protecting against for adversarial input.
 *
 * - Control characters (\x00–\x1f) can corrupt logs and confuse downstream tools.
 *   \x00 (null byte) is especially dangerous: it terminates strings on POSIX,
 *   meaning /workspace/src/foo.ts\x00.pem would pass a .pem check but resolve
 *   to /workspace/src/foo.ts on the filesystem.
 * - ? and # indicate the caller passed a URI instead of a plain filesystem path.
 */
export function validateFilePath(
  filePath: string,
): { ok: true } | { ok: false; reason: "CONTROL_CHARS" | "URI_FRAGMENT" } {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally detecting control chars
  if (/[\x00-\x1f]/.test(filePath)) return { ok: false, reason: "CONTROL_CHARS" };
  if (filePath.includes("?") || filePath.includes("#"))
    return { ok: false, reason: "URI_FRAGMENT" };
  return { ok: true };
}

// Paths that must never be used as a workspace root. See validate-workspace.ts
// for the injected-FileSystem version used at the daemon boundary.
const RESTRICTED_WORKSPACE_ROOTS: ReadonlySet<string> = new Set(
  [
    "/",
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
    path.join(os.homedir(), ".aws"),
    path.join(os.homedir(), ".azure"),
    path.join(os.homedir(), ".gnupg"),
    path.join(os.homedir(), ".kube"),
    path.join(os.homedir(), ".ssh"),
  ].flatMap((p) => {
    try {
      const real = fs.realpathSync(p);
      return real === p ? [p] : [p, real];
    } catch {
      return [p];
    }
  }),
);

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

// Accepted TOCTOU: symlinks are resolved at check time, but the actual write
// happens later — a symlink swapped in between could point outside the
// workspace. Tolerable because weaver is local, single-user, single-process.
export function isWithinWorkspace(filePath: string, workspace: string): boolean {
  const abs = path.resolve(filePath);
  const rel = path.relative(workspace, abs);
  return !rel.startsWith("..");
}

export const SENSITIVE_BASENAME_EXACT = new Set([
  "credentials",
  ".credentials",
  "known_hosts",
  "authorized_keys",
  "id_rsa",
  "id_ecdsa",
  "id_ed25519",
  "id_dsa",
  ".npmrc",
  ".netrc",
  ".vault-token",
  ".htpasswd",
  ".envrc",
  "secrets.yaml",
  "secrets.yml",
]);

export const SENSITIVE_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".cert",
  ".crt",
  ".kdbx",
]);

export const SENSITIVE_BASENAME_PATTERNS: RegExp[] = [/^service-account.*\.json$/, /-key\.json$/];

export function isSensitiveFile(filePath: string): boolean {
  const base = path.basename(filePath);
  const baseLower = base.toLowerCase();
  const ext = path.extname(base).toLowerCase();

  if (SENSITIVE_EXTENSIONS.has(ext)) return true;
  if (SENSITIVE_BASENAME_EXACT.has(baseLower)) return true;
  if (SENSITIVE_BASENAME_PATTERNS.some((re) => re.test(baseLower))) return true;

  // .env, .env.local, .env.production, etc. — basename starts with ".env"
  // followed by end-of-string, a dot, or an underscore.
  if (/^\.env($|\.|_)/i.test(base)) return true;

  return false;
}
