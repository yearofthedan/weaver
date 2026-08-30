import * as path from "node:path";

/**
 * Resolve path parameters in-place: any path param that is a relative string
 * is joined to workspace to produce an absolute path.
 */
export function resolveRelativePaths(
  params: Record<string, unknown>,
  pathParams: string[],
  workspace: string,
): void {
  for (const key of pathParams) {
    const val = params[key];
    if (typeof val === "string" && !path.isAbsolute(val)) {
      params[key] = path.resolve(workspace, val);
    }
  }
}
