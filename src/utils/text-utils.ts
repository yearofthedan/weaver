/**
 * Convert a 0-based character offset in `content` to a 1-based line and column.
 */
export function offsetToLineCol(content: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (content[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

/**
 * Convert a 1-based line and column to a 0-based character offset in `content`.
 * Throws `RangeError` when `line` exceeds the number of lines in the content.
 */
export function lineColToOffset(content: string, line: number, col: number): number {
  const lines = content.split("\n");
  if (line - 1 >= lines.length) {
    throw new RangeError(`Line ${line} out of range (file has ${lines.length} line(s))`);
  }
  let offset = 0;
  for (let i = 0; i < line - 1; i++) {
    offset += lines[i].length + 1; // +1 for \n
  }
  return offset + col - 1;
}

/**
 * Apply an array of non-overlapping text edits to a source string.
 * Edits are applied in descending offset order so earlier offsets stay valid.
 */
export function applyTextEdits(
  text: string,
  edits: readonly { span: { start: number; length: number }; newText: string }[],
): string {
  const sorted = [...edits].sort((a, b) => b.span.start - a.span.start);
  let result = text;
  for (const edit of sorted) {
    result =
      result.slice(0, edit.span.start) +
      edit.newText +
      result.slice(edit.span.start + edit.span.length);
  }
  return result;
}
