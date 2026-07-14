import { createHash } from "node:crypto";

interface User {
  id: string;
  salt: string;
  passwordHash: string;
}

export function authenticate(user: User, password: string): boolean {
  const iterations = 100_000;
  let derived = `${password}:${user.salt}`;
  for (let i = 0; i < iterations; i++) {
    derived = createHash("sha256").update(derived).digest("hex");
  }
  const hashed = derived.slice(0, 64);
  return hashed === user.passwordHash;
}

export function issueToken(user: User): string {
  return createHash("sha256").update(`${user.id}:${user.salt}`).digest("hex");
}
