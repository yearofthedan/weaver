import { parse } from "@vue/language-core";
import { SyntaxKind } from "ts-morph";
import type { NameMatchSample } from "../../operations/types.js";
import { containsName, type ExcludePosition } from "../../ts-engine/name-matches.js";
import { createThrowawaySourceFile } from "../../ts-engine/throwaway-project.js";
import { offsetToLineCol } from "../../utils/text-utils.js";

/**
 * Translates a byte offset within a script block to a 1-based line/col in the
 * full .vue file. Pure function — extracted for unit testing.
 */
export function blockOffsetToFilePosition(
  fileContent: string,
  blockStartOffset: number,
  identOffsetInBlock: number,
): { line: number; col: number } {
  return offsetToLineCol(fileContent, blockStartOffset + identOffsetInBlock);
}

/**
 * Scans old file contents for identifiers that contain oldName as a substring
 * (exact or case-toggled first character), excluding positions that were
 * directly renamed.
 *
 * Handles both .ts and .vue files. For .vue files, only <script> and
 * <script setup> blocks are scanned — template content is not TypeScript.
 */
export function scanVueNameMatches(
  oldName: string,
  oldContents: Map<string, string>,
  excludePositions: ExcludePosition[],
): NameMatchSample[] {
  const excluded = new Set(excludePositions.map((p) => `${p.file}:${p.offset}`));
  const matches: NameMatchSample[] = [];

  for (const [filePath, content] of oldContents) {
    if (filePath.endsWith(".vue")) {
      matches.push(...scanVueFile(filePath, content, oldName, excluded));
    } else {
      matches.push(...scanTsFile(filePath, content, oldName, excluded));
    }
  }

  return matches;
}

function scanTsFile(
  filePath: string,
  content: string,
  oldName: string,
  excluded: Set<string>,
): NameMatchSample[] {
  const sourceFile = createThrowawaySourceFile(filePath, content);
  const matches: NameMatchSample[] = [];

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const text = identifier.getText();
    if (!containsName(text, oldName)) continue;

    const offset = identifier.getStart();
    if (excluded.has(`${filePath}:${offset}`)) continue;

    const { line, character } = sourceFile.compilerNode.getLineAndCharacterOfPosition(offset);
    matches.push({
      file: filePath,
      line: line + 1,
      col: character + 1,
      name: text,
      kind: identifier.getParentOrThrow().getKindName(),
    });
  }

  return matches;
}

function scanVueFile(
  filePath: string,
  content: string,
  oldName: string,
  excluded: Set<string>,
): NameMatchSample[] {
  const { descriptor } = parse(content);
  const blocks = [descriptor.scriptSetup, descriptor.script].filter(
    (b): b is NonNullable<typeof b> => b !== null,
  );

  const matches: NameMatchSample[] = [];
  for (const block of blocks) {
    const blockStart = block.loc.start.offset;
    const blockContent = content.slice(blockStart, block.loc.end.offset);
    const sourceFile = createThrowawaySourceFile(`${filePath}.ts`, blockContent);

    for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const text = identifier.getText();
      if (!containsName(text, oldName)) continue;

      const identOffsetInBlock = identifier.getStart();
      const realOffset = blockStart + identOffsetInBlock;
      if (excluded.has(`${filePath}:${realOffset}`)) continue;

      const { line, col } = blockOffsetToFilePosition(content, blockStart, identOffsetInBlock);
      matches.push({
        file: filePath,
        line,
        col,
        name: text,
        kind: identifier.getParentOrThrow().getKindName(),
      });
    }
  }

  return matches;
}
