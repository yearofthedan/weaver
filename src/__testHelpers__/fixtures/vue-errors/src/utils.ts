export function greet(name: string): string {
  return `Hello, ${name}!`;
}

// TS2322: Type 'number' is not assignable to type 'string'
export const tsError: string = (42 as number);
