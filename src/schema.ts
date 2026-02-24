import { z } from "zod";

export const RenameArgsSchema = z.object({
  file: z.string().min(1, "file path is required"),
  line: z.coerce.number().int().positive("line must be a positive integer (1-based)"),
  col: z.coerce.number().int().positive("col must be a positive integer (1-based)"),
  newName: z
    .string()
    .min(1, "newName is required")
    .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, "newName must be a valid identifier"),
});

export const MoveArgsSchema = z.object({
  oldPath: z.string().min(1, "oldPath is required"),
  newPath: z.string().min(1, "newPath is required"),
});

export const MoveSymbolArgsSchema = z.object({
  sourceFile: z.string().min(1, "sourceFile is required"),
  symbolName: z
    .string()
    .min(1, "symbolName is required")
    .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, "symbolName must be a valid identifier"),
  destFile: z.string().min(1, "destFile is required"),
});

export const FindReferencesArgsSchema = z.object({
  file: z.string().min(1, "file path is required"),
  line: z.coerce.number().int().positive("line must be a positive integer (1-based)"),
  col: z.coerce.number().int().positive("col must be a positive integer (1-based)"),
});

export const GetDefinitionArgsSchema = z.object({
  file: z.string().min(1, "file path is required"),
  line: z.coerce.number().int().positive("line must be a positive integer (1-based)"),
  col: z.coerce.number().int().positive("col must be a positive integer (1-based)"),
});

export const SearchTextArgsSchema = z.object({
  pattern: z.string().min(1, "pattern is required"),
  glob: z.string().optional(),
  context: z.coerce.number().int().min(0).optional(),
  maxResults: z.coerce.number().int().positive().optional(),
});

export const TextEditSchema = z.object({
  file: z.string().min(1),
  line: z.coerce.number().int().positive(),
  col: z.coerce.number().int().positive(),
  oldText: z.string(),
  newText: z.string(),
});

export const ReplaceTextBaseSchema = z.object({
  pattern: z.string().optional(),
  replacement: z.string().optional(),
  glob: z.string().optional(),
  edits: z.array(TextEditSchema).optional(),
});

export const ReplaceTextArgsSchema = ReplaceTextBaseSchema.refine(
  (d) => {
    const hasPattern = d.pattern !== undefined && d.replacement !== undefined;
    const hasEdits = d.edits !== undefined;
    return hasPattern !== hasEdits; // XOR — exactly one mode must be provided
  },
  { message: "Provide either 'pattern'+'replacement' or 'edits', not both" },
);

export type RenameArgs = z.infer<typeof RenameArgsSchema>;
export type MoveArgs = z.infer<typeof MoveArgsSchema>;
export type MoveSymbolArgs = z.infer<typeof MoveSymbolArgsSchema>;
export type FindReferencesArgs = z.infer<typeof FindReferencesArgsSchema>;
export type GetDefinitionArgs = z.infer<typeof GetDefinitionArgsSchema>;
export type SearchTextArgs = z.infer<typeof SearchTextArgsSchema>;
export type ReplaceTextArgs = z.infer<typeof ReplaceTextArgsSchema>;
