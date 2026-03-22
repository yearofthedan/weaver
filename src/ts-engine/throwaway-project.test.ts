import { describe, expect, it } from "vitest";
import { createThrowawaySourceFile } from "./throwaway-project.js";

describe("createThrowawaySourceFile", () => {
  describe("source file creation", () => {
    it("returns a SourceFile with the provided content", () => {
      const content = `import { foo } from "./foo.js";\nexport const bar = 1;\n`;
      const sf = createThrowawaySourceFile("/project/src/index.ts", content);
      expect(sf.getFullText()).toBe(content);
    });

    it("uses the provided filePath as the virtual file path", () => {
      const sf = createThrowawaySourceFile("/some/path/file.ts", "const x = 1;");
      expect(sf.getFilePath()).toBe("/some/path/file.ts");
    });

    it("parses import declarations from the content", () => {
      const content = `import { A } from "./a.js";\nimport { B } from "./b.js";\n`;
      const sf = createThrowawaySourceFile("/project/mod.ts", content);
      const imports = sf.getImportDeclarations();
      expect(imports).toHaveLength(2);
      expect(imports[0].getModuleSpecifierValue()).toBe("./a.js");
      expect(imports[1].getModuleSpecifierValue()).toBe("./b.js");
    });

    it("returns a mutable SourceFile — mutations reflect in getFullText()", () => {
      const content = `import { foo } from "./old.js";\n`;
      const sf = createThrowawaySourceFile("/project/src/index.ts", content);
      const [decl] = sf.getImportDeclarations();
      decl.setModuleSpecifier("./new.js");
      expect(sf.getFullText()).toContain("./new.js");
      expect(sf.getFullText()).not.toContain("./old.js");
    });

    it("accepts a sentinel filename (not a real disk path)", () => {
      const content = `export const x = 42;\n`;
      const sf = createThrowawaySourceFile("__rewrite__.ts", content);
      expect(sf.getFilePath()).toBe("/__rewrite__.ts");
      expect(sf.getFullText()).toBe(content);
    });

    it("each call returns an independent SourceFile", () => {
      const sf1 = createThrowawaySourceFile("/a.ts", `import { X } from "./x.js";\n`);
      const sf2 = createThrowawaySourceFile("/b.ts", `import { Y } from "./y.js";\n`);
      sf1.getImportDeclarations()[0].setModuleSpecifier("./changed.js");
      expect(sf2.getFullText()).toContain("./y.js");
      expect(sf2.getFullText()).not.toContain("./changed.js");
    });
  });
});
