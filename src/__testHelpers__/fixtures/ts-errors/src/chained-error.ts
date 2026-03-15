// TS2345: Argument of type '{ process: (x: number) => string; }' is not assignable
// to parameter of type '{ process: (x: string) => number; }'.
//   Chain[1]: Types of property 'process' are incompatible.
//   Chain[2]: Type '(x: number) => string' is not assignable to type '(x: string) => number'.
//   Chain[3]: Types of parameters 'x' and 'x' are incompatible.
//   Chain[4]: Type 'string' is not assignable to type 'number'.
//
// d.messageText is a DiagnosticMessageChain — NOT a flat string.
// The implementation must return only the top-level node (chain[0]), not flattenDiagnosticMessageText.
function takesProcessor(_p: { process: (x: string) => number }): void {}

takesProcessor({ process: (x: number): string => String(x) });
