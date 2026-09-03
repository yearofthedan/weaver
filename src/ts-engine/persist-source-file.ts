import type { SourceFile } from "ts-morph";
import type { WorkspaceScope } from "../domain/workspace-scope.js";

const BOM = "\uFEFF";

/**
 * Separates a leading byte-order mark from the text that follows it, so
 * content can be rewritten or prefixed without the mark drifting away from
 * byte 0. A mark left mid-file is worse than a missing one: it stops being
 * an encoding hint and becomes a stray character in the source.
 */
export function splitLeadingBom(text: string): { bom: string; body: string } {
  return text.startsWith(BOM)
    ? { bom: BOM, body: text.slice(BOM.length) }
    : { bom: "", body: text };
}

/**
 * Persist a ts-morph `SourceFile` to disk through the workspace's `FileSystem`
 * port, in place of `SourceFile#save()`.
 *
 * `save()` writes `getFullText()` prefixed with a byte-order mark when the
 * file was originally read with one; `getFullText()` itself never includes
 * it, and ts-morph exposes no public way to ask a `SourceFile` whether it had
 * one. This checks the on-disk bytes directly, before this call overwrites
 * them, so a BOM present on disk is carried forward.
 */
export function persistSourceFile(sf: SourceFile, scope: WorkspaceScope): void {
  const filePath = sf.getFilePath() as string;
  const hadBom = scope.fs.exists(filePath) && scope.fs.readFile(filePath).startsWith(BOM);
  const text = sf.getFullText();
  scope.writeFile(filePath, hadBom ? `${BOM}${text}` : text);
}
