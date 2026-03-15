import type { TargetType } from "./target";
import { targetFn } from "./target";

export function useTarget(): string {
  const t: TargetType = { value: targetFn() };
  return t.value;
}
