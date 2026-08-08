import { z } from "zod";

export const RenameArgsSchema = z.object({
  file: z.string().min(1, "file path is required").describe("Absolute path to the file"),
  line: z.coerce
    .number()
    .int()
    .positive("line must be a positive integer (1-based)")
    .describe("Line number (1-based)"),
  col: z.coerce
    .number()
    .int()
    .positive("col must be a positive integer (1-based)")
    .describe("Column number (1-based)"),
  newName: z
    .string()
    .min(1, "newName is required")
    .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, "newName must be a valid identifier")
    .describe("New name for the symbol"),
  checkTypeErrors: z
    .boolean()
    .optional()
    .describe("When false, skip the post-write type check; defaults to on"),
});

export const MoveArgsSchema = z.object({
  oldPath: z.string().min(1, "oldPath is required").describe("Absolute path to the file to move"),
  newPath: z.string().min(1, "newPath is required").describe("Absolute destination path"),
  checkTypeErrors: z
    .boolean()
    .optional()
    .describe("When false, skip the post-write type check; defaults to on"),
});

export const MoveSymbolArgsSchema = z.object({
  sourceFile: z
    .string()
    .min(1, "sourceFile is required")
    .describe("Absolute path to the file containing the symbol"),
  symbolName: z
    .string()
    .min(1, "symbolName is required")
    .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, "symbolName must be a valid identifier")
    .describe("Name of the exported symbol to move"),
  destFile: z
    .string()
    .min(1, "destFile is required")
    .describe("Absolute path of the destination file (created if it does not exist)"),
  force: z
    .boolean()
    .optional()
    .describe(
      "When true and the destination already exports a symbol with the same name, replace the existing declaration with the source version. When false or omitted, returns SYMBOL_EXISTS error on conflict.",
    ),
  checkTypeErrors: z
    .boolean()
    .optional()
    .describe("When false, skip the post-write type check; defaults to on"),
});

export const FindReferencesArgsSchema = z.object({
  file: z.string().min(1, "file path is required").describe("Absolute path to the file"),
  line: z.coerce
    .number()
    .int()
    .positive("line must be a positive integer (1-based)")
    .describe("Line number (1-based)"),
  col: z.coerce
    .number()
    .int()
    .positive("col must be a positive integer (1-based)")
    .describe("Column number (1-based)"),
});

export const GetDefinitionArgsSchema = z.object({
  file: z.string().min(1, "file path is required").describe("Absolute path to the file"),
  line: z.coerce
    .number()
    .int()
    .positive("line must be a positive integer (1-based)")
    .describe("Line number (1-based)"),
  col: z.coerce
    .number()
    .int()
    .positive("col must be a positive integer (1-based)")
    .describe("Column number (1-based)"),
});

export const FindImportersArgsSchema = z.object({
  file: z.string().min(1, "file path is required").describe("Absolute path to the file"),
});

export const SearchTextArgsSchema = z.object({
  pattern: z
    .string()
    .min(1, "pattern is required")
    .describe("ECMAScript regex pattern to search for"),
  glob: z
    .string()
    .optional()
    .describe(
      "Optional glob to restrict which files are searched (e.g. '**/*.ts', '**/*.{ts,vue}'). Brace groups like {ts,vue} are expanded. Character classes [...] and nested braces are not supported and throw INVALID_GLOB.",
    ),
  excludeGlob: z
    .string()
    .optional()
    .describe(
      "Optional glob of files to exclude, applied after `glob` (e.g. 'docs/archive/**'). Exclude multiple trees with a brace group: '{docs/archive/**,dist/**}'. Same syntax and limits as `glob`.",
    ),
  context: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Lines of context before and after each match (like grep -C)"),
  maxResults: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Cap on total matches returned (default 500)"),
});

export const TextEditSchema = z.object({
  file: z.string().min(1).describe("Absolute path to the file"),
  line: z.coerce.number().int().positive().describe("Line number (1-based)"),
  col: z.coerce.number().int().positive().describe("Column number (1-based)"),
  oldText: z.string().describe("Text that must be present at the given position"),
  newText: z.string().describe("Text to write in place of oldText"),
});

export const ReplaceTextBaseSchema = z.object({
  pattern: z.string().optional().describe("Regex pattern to replace (pattern mode)"),
  replacement: z
    .string()
    .optional()
    .describe("Replacement string; supports $1, $2, ... backreferences (pattern mode)"),
  glob: z
    .string()
    .optional()
    .describe(
      "Optional glob to restrict which files are modified (pattern mode). Brace groups like {ts,js} are expanded. Character classes [...] and nested braces throw INVALID_GLOB.",
    ),
  excludeGlob: z
    .string()
    .optional()
    .describe(
      "Optional glob of files to exclude, applied after `glob` (e.g. 'docs/archive/**'). Exclude multiple trees with a brace group: '{docs/archive/**,dist/**}'. Same syntax and limits as `glob`.",
    ),
  edits: z.array(TextEditSchema).optional().describe("Surgical edits array (surgical mode)"),
  checkTypeErrors: z
    .boolean()
    .optional()
    .describe("When false, skip the post-write type check; defaults to on"),
});

export const GetTypeErrorsArgsSchema = z.object({
  file: z
    .string()
    .min(1, "file path must not be empty")
    .optional()
    .describe("Absolute path to a single .ts/.tsx file to check (omit to check the whole project)"),
});

export const DeleteFileArgsSchema = z.object({
  file: z
    .string()
    .min(1, "file path is required")
    .describe("Absolute path to the .ts, .tsx, .js, .jsx, or .vue file to delete"),
  checkTypeErrors: z
    .boolean()
    .optional()
    .describe("When false, skip the post-write type check on modified files; defaults to on"),
});

export const ExtractFunctionArgsSchema = z.object({
  file: z
    .string()
    .min(1, "file path is required")
    .describe("Absolute path to the .ts or .tsx file containing the code to extract"),
  startLine: z.coerce
    .number()
    .int()
    .positive("startLine must be a positive integer (1-based)")
    .describe("Start line of the selection (1-based)"),
  startCol: z.coerce
    .number()
    .int()
    .positive("startCol must be a positive integer (1-based)")
    .describe("Start column of the selection (1-based)"),
  endLine: z.coerce
    .number()
    .int()
    .positive("endLine must be a positive integer (1-based)")
    .describe("End line of the selection (1-based)"),
  endCol: z.coerce
    .number()
    .int()
    .positive("endCol must be a positive integer (1-based)")
    .describe(
      "End column of the selection (1-based, inclusive). Must cover the last character of the last statement.",
    ),
  functionName: z
    .string()
    .min(1, "functionName is required")
    .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, "functionName must be a valid identifier")
    .describe("Name for the extracted function (must be a valid identifier)"),
  checkTypeErrors: z
    .boolean()
    .optional()
    .describe("When false, skip the post-write type check; defaults to on"),
});

export const ReplaceTextArgsSchema = ReplaceTextBaseSchema.refine(
  (d) => {
    const hasPattern = d.pattern !== undefined && d.replacement !== undefined;
    const hasEdits = d.edits !== undefined;
    return hasPattern !== hasEdits; // XOR — exactly one mode must be provided
  },
  { message: "Provide either 'pattern'+'replacement' or 'edits', not both" },
);

export const MoveDirectoryArgsSchema = z.object({
  oldPath: z
    .string()
    .min(1, "oldPath is required")
    .describe("Absolute path to the source directory"),
  newPath: z
    .string()
    .min(1, "newPath is required")
    .describe(
      "Absolute path to the destination directory (created if needed; must not already exist as a non-empty directory)",
    ),
  checkTypeErrors: z
    .boolean()
    .optional()
    .describe("When false, skip the post-write type check; defaults to on"),
});

export type MoveDirectoryArgs = z.infer<typeof MoveDirectoryArgsSchema>;

export type DeleteFileArgs = z.infer<typeof DeleteFileArgsSchema>;
export type GetTypeErrorsArgs = z.infer<typeof GetTypeErrorsArgsSchema>;
export type RenameArgs = z.infer<typeof RenameArgsSchema>;
export type MoveArgs = z.infer<typeof MoveArgsSchema>;
export type MoveSymbolArgs = z.infer<typeof MoveSymbolArgsSchema>;
export type FindReferencesArgs = z.infer<typeof FindReferencesArgsSchema>;
export type FindImportersArgs = z.infer<typeof FindImportersArgsSchema>;
export type GetDefinitionArgs = z.infer<typeof GetDefinitionArgsSchema>;
export type SearchTextArgs = z.infer<typeof SearchTextArgsSchema>;
export type ReplaceTextArgs = z.infer<typeof ReplaceTextArgsSchema>;
export type ExtractFunctionArgs = z.infer<typeof ExtractFunctionArgsSchema>;
