import { type Project, SyntaxKind } from "ts-morph";
import type { NameMatchSample } from "../operations/types.js";

export interface ExcludePosition {
  file: string;
  offset: number;
}

// Check both the exact name and its first-char-case-toggled variant so that
// renaming PascalCase `TsProvider` also finds camelCase derivatives like
// `tsProviderSingleton`, and renaming camelCase `tsProvider` finds
// `TsProvider`-prefixed declarations.
function containsName(text: string, oldName: string): boolean {
  if (text.includes(oldName)) return true;
  const first = oldName[0];
  const toggled = first === first.toUpperCase() ? first.toLowerCase() : first.toUpperCase();
  return text.includes(toggled + oldName.slice(1));
}

export function scanNameMatches(
  project: Project,
  oldName: string,
  filesModified: string[],
  excludePositions: ExcludePosition[],
): NameMatchSample[] {
  const excluded = new Set(excludePositions.map((p) => `${p.file}:${p.offset}`));
  const matches: NameMatchSample[] = [];

  for (const filePath of filesModified) {
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) continue;

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
  }

  return matches;
}
