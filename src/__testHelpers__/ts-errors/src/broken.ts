export function add(a: number, b: number): number {
  return a + b;
}

// TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
const _r1 = add("hello", 1);
// TS2322: Type 'number' is not assignable to type 'string'
const _r2: string = add(1, 2);
// TS2322: Type 'number' is not assignable to type 'boolean'
const _r3: boolean = add(1, 2);
