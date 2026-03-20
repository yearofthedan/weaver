import { afterEach } from "vitest";
import { invalidateAll } from "../daemon/language-plugin-registry.js";

/**
 * Global test cleanup: dispose of cached engines after each test.
 * Prevents memory leaks from accumulated Project instances in TsMorphEngine.
 */
afterEach(() => {
  invalidateAll();
});
