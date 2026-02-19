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

export type RenameArgs = z.infer<typeof RenameArgsSchema>;
export type MoveArgs = z.infer<typeof MoveArgsSchema>;
