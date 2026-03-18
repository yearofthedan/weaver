import { Project, type SourceFile } from "ts-morph";

/**
 * Creates a throwaway in-memory ts-morph SourceFile for script parsing and
 * mutation. The project is not retained — callers use the returned SourceFile
 * to inspect or mutate AST nodes, then call `getFullText()` to retrieve the
 * rewritten content.
 *
 * `filePath` is used only as the virtual file path inside the in-memory
 * project (for relative specifier resolution). The file does not need to
 * exist on disk.
 */
export function createThrowawaySourceFile(filePath: string, content: string): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(filePath, content);
}
