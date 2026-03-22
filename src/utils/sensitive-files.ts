import * as path from "node:path";

/**
 * File basenames that always indicate sensitive content regardless of location.
 * Matched case-insensitively against the file's basename.
 */
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

/**
 * File extensions that indicate sensitive content (private keys, certificates,
 * keystores, password databases). Matched against the full extension, lowercased.
 */
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

/**
 * Regex patterns matched against the lowercased basename.
 * Used for wildcard-style matches like service-account*.json and *-key.json.
 */
export const SENSITIVE_BASENAME_PATTERNS: RegExp[] = [/^service-account.*\.json$/, /-key\.json$/];

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
  if (SENSITIVE_BASENAME_PATTERNS.some((re) => re.test(baseLower))) return true;

  // .env, .env.local, .env.production, etc. — basename starts with ".env"
  // followed by end-of-string, a dot, or an underscore.
  if (/^\.env($|\.|_)/i.test(base)) return true;

  return false;
}
