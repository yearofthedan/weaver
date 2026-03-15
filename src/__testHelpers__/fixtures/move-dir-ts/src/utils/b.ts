import { fnA } from "./a";
export function fnB(): string {
  return `${fnA()}b`;
}
