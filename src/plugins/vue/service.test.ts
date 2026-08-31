import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVolarService } from "./service.js";

describe("buildVolarService", () => {
  describe("scriptFileNames", () => {
    it("covers the tsconfig's own files and always-included .vue files, but not the workspace walk", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "volar-service-"));
      try {
        fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
        const tsConfigPath = path.join(tmpDir, "tsconfig.json");
        fs.writeFileSync(
          tsConfigPath,
          JSON.stringify({
            compilerOptions: { strict: true, moduleResolution: "bundler" },
            include: ["src/**/*.ts", "src/**/*.vue"],
          }),
        );
        fs.writeFileSync(path.join(tmpDir, "src/main.ts"), "export const x = 1;\n");
        fs.writeFileSync(path.join(tmpDir, "src/App.vue"), "<template><div /></template>\n");
        // Not under tsconfig.include — only pulled in by the workspace-wide walk.
        fs.writeFileSync(path.join(tmpDir, "tests/outside.ts"), "export const y = 2;\n");

        const service = await buildVolarService(tsConfigPath, undefined, tmpDir);

        const mainTs = path.join(tmpDir, "src/main.ts");
        const appVueTs = `${path.join(tmpDir, "src/App.vue")}.ts`;
        const outsideTs = path.join(tmpDir, "tests/outside.ts");

        expect(service.scriptFileNames).toContain(mainTs);
        expect(service.scriptFileNames).toContain(appVueTs);
        expect(service.scriptFileNames).not.toContain(outsideTs);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("still includes the workspace-walked file in the language service host's own script set", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "volar-service-host-"));
      try {
        fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
        const tsConfigPath = path.join(tmpDir, "tsconfig.json");
        fs.writeFileSync(
          tsConfigPath,
          JSON.stringify({
            compilerOptions: { strict: true, moduleResolution: "bundler" },
            include: ["src/**/*.ts", "src/**/*.vue"],
          }),
        );
        fs.writeFileSync(path.join(tmpDir, "src/main.ts"), "export const x = 1;\n");
        fs.writeFileSync(path.join(tmpDir, "tests/outside.ts"), "export const y = 2;\n");

        const service = await buildVolarService(tsConfigPath, undefined, tmpDir);
        const outsideTs = path.join(tmpDir, "tests/outside.ts");

        // Not part of scriptFileNames (the diagnostics-safe subset)...
        expect(service.scriptFileNames).not.toContain(outsideTs);
        // ...but still resolvable through the language service itself, since
        // rename/find-references still need it.
        expect(() => service.baseService.getSemanticDiagnostics(outsideTs)).not.toThrow();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
