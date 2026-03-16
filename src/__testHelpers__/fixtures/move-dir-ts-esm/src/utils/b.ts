import { fnA } from "./a.js";
export function fnB(): string {
  return `${fnA()}b`;
}
