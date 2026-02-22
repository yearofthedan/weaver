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
