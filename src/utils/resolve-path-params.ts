import * as path from "node:path";

/** A path-param declaration split into the container it lives under and the key within it. */
interface PathParamDeclaration {
  /** The array the key lives on, or null for a top-level declaration. */
  container: string | null;
  /** The parameter name — a top-level key, or the key read from each array element. */
  key: string;
}

/** `"edits[].file"` — an array key, then the key read from each of its elements. */
const NESTED_DECLARATION = /^([^[\].]+)\[\]\.([^[\].]+)$/;

/**
 * A declaration is either a top-level key (`"file"`) or a nested one
 * (`"edits[].file"`). Parsing here keeps the syntax understood in one place, so
 * the resolver, the validator, and engine selection cannot drift apart.
 */
function parsePathParam(declaration: string): PathParamDeclaration {
  const nested = NESTED_DECLARATION.exec(declaration);
  return nested === null
    ? { container: null, key: declaration }
    : { container: nested[1], key: nested[2] };
}

/**
 * The objects a declaration reads its key from: `params` itself for a flat
 * declaration, the object elements of the named array for a nested one.
 */
function pathParamTargets(
  params: Record<string, unknown>,
  container: string | null,
): Record<string, unknown>[] {
  if (container === null) return [params];
  const elements = params[container];
  if (!Array.isArray(elements)) return [];
  return elements.filter(
    (element): element is Record<string, unknown> =>
      element !== null && typeof element === "object",
  );
}

/**
 * Resolve path parameters in-place: any path param that is a relative string
 * is joined to workspace to produce an absolute path.
 *
 * A nested declaration (`"edits[].file"`) names an array on `params` and a key
 * within each of its elements; every element's key is resolved independently.
 * A missing or empty array is a no-op.
 */
export function resolveRelativePaths(
  params: Record<string, unknown>,
  pathParams: string[],
  workspace: string,
): void {
  for (const declaration of pathParams) {
    const { container, key } = parsePathParam(declaration);
    for (const target of pathParamTargets(params, container)) {
      const val = target[key];
      if (typeof val === "string" && !path.isAbsolute(val)) {
        target[key] = path.resolve(workspace, val);
      }
    }
  }
}

/**
 * The path strings a declaration names in `params`, in order — every value the
 * caller supplied for that path param. The dispatcher validates each one before
 * the operation runs. Values that are not strings are omitted.
 */
export function declaredPathValues(params: Record<string, unknown>, declaration: string): string[] {
  const { container, key } = parsePathParam(declaration);
  const values: string[] = [];
  for (const target of pathParamTargets(params, container)) {
    const value = target[key];
    if (typeof value === "string") values.push(value);
  }
  return values;
}

/** Whether a declaration names a top-level key (`"file"`) rather than an array element. */
export function isTopLevelPathParam(declaration: string): boolean {
  return parsePathParam(declaration).container === null;
}
