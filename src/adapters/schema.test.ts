import { describe, expect, it } from "vitest";
import {
  DeleteFileArgsSchema,
  ExtractFunctionArgsSchema,
  FindImportersArgsSchema,
  FindReferencesArgsSchema,
  GetDefinitionArgsSchema,
  GetTypeErrorsArgsSchema,
  MoveArgsSchema,
  MoveDirectoryArgsSchema,
  MoveSymbolArgsSchema,
  RenameArgsSchema,
  ReplaceTextArgsSchema,
  ReplaceTextBaseSchema,
  SearchTextArgsSchema,
  TextEditSchema,
} from "./schema.js";

describe("schema parameter descriptions", () => {
  describe("RenameArgsSchema", () => {
    it("file field carries its description", () => {
      expect(RenameArgsSchema.shape.file.description).toBe("Absolute path to the file");
    });

    it("line field carries its description", () => {
      expect(RenameArgsSchema.shape.line.description).toBe("Line number (1-based)");
    });

    it("col field carries its description", () => {
      expect(RenameArgsSchema.shape.col.description).toBe("Column number (1-based)");
    });

    it("newName field carries its description", () => {
      expect(RenameArgsSchema.shape.newName.description).toBe("New name for the symbol");
    });

    it("checkTypeErrors optional field carries its description", () => {
      expect(RenameArgsSchema.shape.checkTypeErrors.description).toBe(
        "When false, skip the post-write type check; defaults to on",
      );
    });
  });

  describe("MoveArgsSchema", () => {
    it("oldPath field carries its description", () => {
      expect(MoveArgsSchema.shape.oldPath.description).toBe("Absolute path to the file to move");
    });

    it("newPath field carries its description", () => {
      expect(MoveArgsSchema.shape.newPath.description).toBe("Absolute destination path");
    });

    it("checkTypeErrors optional field carries its description", () => {
      expect(MoveArgsSchema.shape.checkTypeErrors.description).toBe(
        "When false, skip the post-write type check; defaults to on",
      );
    });
  });

  describe("MoveDirectoryArgsSchema", () => {
    it("oldPath field carries its description", () => {
      expect(MoveDirectoryArgsSchema.shape.oldPath.description).toBe(
        "Absolute path to the source directory",
      );
    });

    it("newPath field carries its description", () => {
      expect(MoveDirectoryArgsSchema.shape.newPath.description).toContain(
        "Absolute path to the destination directory",
      );
    });
  });

  describe("MoveSymbolArgsSchema", () => {
    it("sourceFile field carries its description", () => {
      expect(MoveSymbolArgsSchema.shape.sourceFile.description).toBe(
        "Absolute path to the file containing the symbol",
      );
    });

    it("symbolName field carries its description", () => {
      expect(MoveSymbolArgsSchema.shape.symbolName.description).toBe(
        "Name of the exported symbol to move",
      );
    });

    it("destFile field carries its description", () => {
      expect(MoveSymbolArgsSchema.shape.destFile.description).toContain(
        "Absolute path of the destination file",
      );
    });

    it("force optional field carries its description", () => {
      expect(MoveSymbolArgsSchema.shape.force.description).toContain("SYMBOL_EXISTS");
    });

    it("checkTypeErrors optional field carries its description", () => {
      expect(MoveSymbolArgsSchema.shape.checkTypeErrors.description).toBe(
        "When false, skip the post-write type check; defaults to on",
      );
    });
  });

  describe("ExtractFunctionArgsSchema", () => {
    it("file field carries its description", () => {
      expect(ExtractFunctionArgsSchema.shape.file.description).toContain(
        "Absolute path to the .ts or .tsx file",
      );
    });

    it("startLine field carries its description", () => {
      expect(ExtractFunctionArgsSchema.shape.startLine.description).toBe(
        "Start line of the selection (1-based)",
      );
    });

    it("endCol field carries its description that mentions inclusive", () => {
      expect(ExtractFunctionArgsSchema.shape.endCol.description).toContain("inclusive");
    });

    it("functionName field carries its description", () => {
      expect(ExtractFunctionArgsSchema.shape.functionName.description).toBe(
        "Name for the extracted function (must be a valid identifier)",
      );
    });
  });

  describe("DeleteFileArgsSchema", () => {
    it("file field carries its description", () => {
      expect(DeleteFileArgsSchema.shape.file.description).toContain(
        "Absolute path to the .ts, .tsx",
      );
    });

    it("checkTypeErrors optional field carries its description", () => {
      expect(DeleteFileArgsSchema.shape.checkTypeErrors.description).toContain(
        "skip the post-write type check",
      );
    });
  });

  describe("FindImportersArgsSchema", () => {
    it("file field carries its description", () => {
      expect(FindImportersArgsSchema.shape.file.description).toBe("Absolute path to the file");
    });
  });

  describe("FindReferencesArgsSchema", () => {
    it("file field carries its description", () => {
      expect(FindReferencesArgsSchema.shape.file.description).toBe("Absolute path to the file");
    });

    it("line field carries its description", () => {
      expect(FindReferencesArgsSchema.shape.line.description).toBe("Line number (1-based)");
    });

    it("col field carries its description", () => {
      expect(FindReferencesArgsSchema.shape.col.description).toBe("Column number (1-based)");
    });
  });

  describe("GetDefinitionArgsSchema", () => {
    it("file field carries its description", () => {
      expect(GetDefinitionArgsSchema.shape.file.description).toBe("Absolute path to the file");
    });
  });

  describe("GetTypeErrorsArgsSchema", () => {
    it("file optional field carries its description", () => {
      expect(GetTypeErrorsArgsSchema.shape.file.description).toContain(
        "Absolute path to a single .ts/.tsx file",
      );
    });
  });

  describe("SearchTextArgsSchema", () => {
    it("pattern field carries its description", () => {
      expect(SearchTextArgsSchema.shape.pattern.description).toBe(
        "ECMAScript regex pattern to search for",
      );
    });

    it("glob optional field carries its description", () => {
      expect(SearchTextArgsSchema.shape.glob.description).toContain(
        "Optional glob to restrict which files are searched",
      );
    });

    it("excludeGlob optional field carries its description", () => {
      expect(SearchTextArgsSchema.shape.excludeGlob.description).toContain(
        "Optional glob of files to exclude, applied after `glob`",
      );
    });

    it("context optional field carries its description", () => {
      expect(SearchTextArgsSchema.shape.context.description).toContain("grep -C");
    });

    it("maxResults optional field carries its description", () => {
      expect(SearchTextArgsSchema.shape.maxResults.description).toContain("Cap on total matches");
    });
  });

  describe("ReplaceTextBaseSchema", () => {
    it("pattern optional field carries its description", () => {
      expect(ReplaceTextBaseSchema.shape.pattern.description).toBe(
        "Regex pattern to replace (pattern mode)",
      );
    });

    it("replacement optional field carries its description", () => {
      expect(ReplaceTextBaseSchema.shape.replacement.description).toContain("backreferences");
    });

    it("glob optional field carries its description", () => {
      expect(ReplaceTextBaseSchema.shape.glob.description).toContain(
        "Optional glob to restrict which files are modified",
      );
    });

    it("excludeGlob optional field carries its description", () => {
      expect(ReplaceTextBaseSchema.shape.excludeGlob.description).toContain(
        "Optional glob of files to exclude, applied after `glob`",
      );
    });

    it("edits optional field carries its description", () => {
      expect(ReplaceTextBaseSchema.shape.edits.description).toBe(
        "Surgical edits array (surgical mode)",
      );
    });

    it("checkTypeErrors optional field carries its description", () => {
      expect(ReplaceTextBaseSchema.shape.checkTypeErrors.description).toContain(
        "skip the post-write type check",
      );
    });
  });

  describe("TextEditSchema", () => {
    it("file field carries its description", () => {
      expect(TextEditSchema.shape.file.description).toBe("Absolute path to the file");
    });

    it("oldText field carries its description", () => {
      expect(TextEditSchema.shape.oldText.description).toBe(
        "Text that must be present at the given position",
      );
    });

    it("newText field carries its description", () => {
      expect(TextEditSchema.shape.newText.description).toBe("Text to write in place of oldText");
    });
  });
});

describe("schema validation", () => {
  describe("RenameArgsSchema", () => {
    it("rejects empty string for file (min-length guard)", () => {
      const result = RenameArgsSchema.safeParse({ file: "", line: 1, col: 1, newName: "foo" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string for newName (min-length guard)", () => {
      const result = RenameArgsSchema.safeParse({
        file: "/a.ts",
        line: 1,
        col: 1,
        newName: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a newName that starts with a digit (identifier guard)", () => {
      const result = RenameArgsSchema.safeParse({
        file: "/a.ts",
        line: 1,
        col: 1,
        newName: "1invalid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a newName containing spaces (identifier guard)", () => {
      const result = RenameArgsSchema.safeParse({
        file: "/a.ts",
        line: 1,
        col: 1,
        newName: "foo bar",
      });
      expect(result.success).toBe(false);
    });

    it("accepts a valid newName", () => {
      const result = RenameArgsSchema.safeParse({
        file: "/a.ts",
        line: 1,
        col: 1,
        newName: "validName",
      });
      expect(result.success).toBe(true);
    });

    it("accepts a newName with leading underscore (identifier guard)", () => {
      const result = RenameArgsSchema.safeParse({
        file: "/a.ts",
        line: 1,
        col: 1,
        newName: "_privateVar",
      });
      expect(result.success).toBe(true);
    });

    it("accepts a newName with dollar sign (identifier guard)", () => {
      const result = RenameArgsSchema.safeParse({
        file: "/a.ts",
        line: 1,
        col: 1,
        newName: "$ref",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("MoveArgsSchema", () => {
    it("rejects empty string for oldPath (min-length guard)", () => {
      const result = MoveArgsSchema.safeParse({ oldPath: "", newPath: "/b.ts" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string for newPath (min-length guard)", () => {
      const result = MoveArgsSchema.safeParse({ oldPath: "/a.ts", newPath: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("ReplaceTextArgsSchema (exactly-one-mode invariant)", () => {
    const edit = { file: "/a.ts", line: 1, col: 1, oldText: "a", newText: "b" };

    it("rejects when neither pattern mode nor edits are provided", () => {
      expect(ReplaceTextArgsSchema.safeParse({}).success).toBe(false);
    });

    it("rejects when both pattern mode and edits are provided", () => {
      const result = ReplaceTextArgsSchema.safeParse({
        pattern: "a",
        replacement: "b",
        edits: [edit],
      });
      expect(result.success).toBe(false);
    });

    it("rejects pattern without replacement (incomplete pattern mode, no edits)", () => {
      expect(ReplaceTextArgsSchema.safeParse({ pattern: "a" }).success).toBe(false);
    });

    it("rejects replacement without pattern (incomplete pattern mode, no edits)", () => {
      expect(ReplaceTextArgsSchema.safeParse({ replacement: "b" }).success).toBe(false);
    });

    it("accepts pattern mode alone (pattern + replacement)", () => {
      expect(ReplaceTextArgsSchema.safeParse({ pattern: "a", replacement: "b" }).success).toBe(
        true,
      );
    });

    it("accepts surgical edits mode alone", () => {
      expect(ReplaceTextArgsSchema.safeParse({ edits: [edit] }).success).toBe(true);
    });
  });
});
