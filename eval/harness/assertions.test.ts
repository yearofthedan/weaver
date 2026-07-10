import { describe, expect, it } from "vitest";
import {
  extractBashCommands,
  extractCommandsFromText,
  isAnyWeaverInvocation,
  isWeaverInvocation,
  matchWeaverCommand,
} from "./assertions.js";
import type { ToolCall } from "./call-model.js";

function bashCall(command: string): ToolCall {
  return { name: "bash", arguments: { command } };
}

function otherCall(name: string): ToolCall {
  return { name, arguments: { foo: "bar" } };
}

describe("extractBashCommands", () => {
  describe("happy path", () => {
    it("returns the command string from a bash tool call", () => {
      const result = extractBashCommands([bashCall("weaver rename '{}'")]);
      expect(result).toEqual(["weaver rename '{}'"]);
    });

    it("returns all commands when multiple bash calls are present", () => {
      const calls = [bashCall("weaver search-text '{}'"), bashCall("weaver rename '{}'")];
      const result = extractBashCommands(calls);
      expect(result).toEqual(["weaver search-text '{}'", "weaver rename '{}'"]);
    });

    it("filters out non-bash tool calls", () => {
      const calls = [otherCall("skill"), bashCall("weaver rename '{}'"), otherCall("grep")];
      const result = extractBashCommands(calls);
      expect(result).toEqual(["weaver rename '{}'"]);
    });

    it("splits &&-chained commands into separate candidates", () => {
      const result = extractBashCommands([
        bashCall(`cd /tmp/weaver-eval && weaver replace-text '{"pattern": "v1"}'`),
      ]);
      expect(result).toEqual(["cd /tmp/weaver-eval", `weaver replace-text '{"pattern": "v1"}'`]);
    });

    it("does not split on semicolons, which appear inside JSON pattern arguments", () => {
      const result = extractBashCommands([bashCall(`weaver search-text '{"pattern": "a;b"}'`)]);
      expect(result).toEqual([`weaver search-text '{"pattern": "a;b"}'`]);
    });
  });

  describe("zero case", () => {
    it("returns empty array when no tool calls are present", () => {
      expect(extractBashCommands([])).toEqual([]);
    });

    it("returns empty array when no bash calls are present", () => {
      expect(extractBashCommands([otherCall("skill"), otherCall("grep")])).toEqual([]);
    });
  });
});

describe("isWeaverInvocation", () => {
  describe("matching forms", () => {
    it("matches a bare weaver subcommand with flag-style args", () => {
      expect(isWeaverInvocation("weaver rename --file x", "rename")).toBe(true);
    });

    it("matches npx weaver prefix with a quoted JSON argument", () => {
      expect(isWeaverInvocation('npx weaver rename \'{"file":"x"}\'', "rename")).toBe(true);
    });

    it("matches pnpm exec weaver prefix", () => {
      expect(isWeaverInvocation("pnpm exec weaver rename --newName bar", "rename")).toBe(true);
    });

    it("matches a hyphenated subcommand", () => {
      expect(isWeaverInvocation("weaver search-text --pattern foo", "search-text")).toBe(true);
    });
  });

  describe("non-matching cases", () => {
    it("does not match a different subcommand", () => {
      expect(isWeaverInvocation("weaver search-text --pattern foo", "rename")).toBe(false);
    });

    it("does not match a subcommand that is only a prefix of the actual name (word boundary)", () => {
      expect(isWeaverInvocation("weaver renamed --newName bar", "rename")).toBe(false);
    });

    it("does not match a non-weaver command", () => {
      expect(isWeaverInvocation("grep -r userId src/", "rename")).toBe(false);
    });

    it("does not match an empty command string", () => {
      expect(isWeaverInvocation("", "rename")).toBe(false);
    });
  });
});

describe("isAnyWeaverInvocation", () => {
  describe("matching forms", () => {
    it("matches a bare weaver command regardless of subcommand", () => {
      expect(isAnyWeaverInvocation("weaver rename --file x")).toBe(true);
    });

    it("matches npx weaver prefix form", () => {
      expect(isAnyWeaverInvocation('npx weaver search-text \'{"pattern":"x"}\'')).toBe(true);
    });

    it("matches pnpm exec weaver prefix form", () => {
      expect(isAnyWeaverInvocation("pnpm exec weaver find-references --file x")).toBe(true);
    });
  });

  describe("non-matching cases", () => {
    it("does not match a non-weaver command", () => {
      expect(isAnyWeaverInvocation("ls -la /tmp/weaver-eval/src")).toBe(false);
    });

    it("does not match a command that merely mentions weaver mid-string", () => {
      expect(isAnyWeaverInvocation("echo 'ask weaver later'")).toBe(false);
    });

    it("does not match an empty command string", () => {
      expect(isAnyWeaverInvocation("")).toBe(false);
    });

    it("does not match weaver with no subcommand", () => {
      expect(isAnyWeaverInvocation("weaver")).toBe(false);
    });
  });
});

describe("matchWeaverCommand", () => {
  describe("happy path", () => {
    it("matches a plain weaver subcommand with single-quoted JSON", () => {
      const result = matchWeaverCommand(
        'weaver rename \'{"file":"src/a.ts","line":1,"col":1,"newName":"bar"}\'',
        "rename",
        { newName: "bar" },
      );
      expect(result.matched).toBe(true);
    });

    it("extractCommandsFromText strips code fences and blank lines", () => {
      const text = '```bash\nweaver rename \'{"newName":"bar"}\'\n```\n';
      expect(extractCommandsFromText(text)).toEqual(['weaver rename \'{"newName":"bar"}\'']);
    });

    it("extractCommandsFromText returns empty array for blank response", () => {
      expect(extractCommandsFromText("")).toEqual([]);
      expect(extractCommandsFromText("\n  \n")).toEqual([]);
    });

    it("extractCommandsFromText splits &&-chained commands into separate candidates", () => {
      const text = `weaver find-references '{"file":"a.ts"}' > /dev/null && weaver delete-file '{"file":"a.ts"}'`;
      expect(extractCommandsFromText(text)).toEqual([
        `weaver find-references '{"file":"a.ts"}' > /dev/null`,
        `weaver delete-file '{"file":"a.ts"}'`,
      ]);
    });

    it("extractCommandsFromText does not split on semicolons inside JSON patterns", () => {
      const text = `weaver search-text '{"pattern": "a;b"}'`;
      expect(extractCommandsFromText(text)).toEqual([`weaver search-text '{"pattern": "a;b"}'`]);
    });

    it("extractCommandsFromText returns one candidate per non-empty line", () => {
      const text = "weaver search-text '{}'\n\nweaver rename '{}'";
      expect(extractCommandsFromText(text)).toEqual([
        "weaver search-text '{}'",
        "weaver rename '{}'",
      ]);
    });

    it("matches pnpm exec weaver prefix form", () => {
      const result = matchWeaverCommand('pnpm exec weaver rename \'{"newName":"bar"}\'', "rename", {
        newName: "bar",
      });
      expect(result.matched).toBe(true);
    });

    it("matches npx weaver prefix form", () => {
      const result = matchWeaverCommand('npx weaver rename \'{"newName":"bar"}\'', "rename", {
        newName: "bar",
      });
      expect(result.matched).toBe(true);
    });

    it("matches npx weaver with subcommand-only assertion", () => {
      const result = matchWeaverCommand("npx weaver find-references '{}'", "find-references");
      expect(result.matched).toBe(true);
    });

    it("does not match npx weaver with wrong subcommand", () => {
      const result = matchWeaverCommand("npx weaver move-file '{}'", "rename");
      expect(result.matched).toBe(false);
      expect(result.reason).toContain("rename");
      expect(result.reason).toContain("move-file");
    });

    it("matches double-quote form around the JSON argument", () => {
      const result = matchWeaverCommand('weaver rename "{"newName":"bar"}"', "rename", {
        newName: "bar",
      });
      expect(result.matched).toBe(true);
    });

    it("matches double-quote form with bash-escaped inner quotes", () => {
      const result = matchWeaverCommand('weaver rename "{\\"newName\\":\\"bar\\"}"', "rename", {
        newName: "bar",
      });
      expect(result.matched).toBe(true);
    });

    it("matches when keyArgs is absent (subcommand-only assertion)", () => {
      const result = matchWeaverCommand("weaver find-references '{}'", "find-references");
      expect(result.matched).toBe(true);
    });

    it("matches when keyArgs is an empty object", () => {
      const result = matchWeaverCommand('weaver rename \'{"newName":"x"}\'', "rename", {});
      expect(result.matched).toBe(true);
    });
  });

  describe("wrong subcommand", () => {
    it("does not match when the subcommand differs", () => {
      const result = matchWeaverCommand("weaver move-file '{}'", "rename");
      expect(result.matched).toBe(false);
    });

    it("includes both expected and actual subcommand in the failure reason", () => {
      const result = matchWeaverCommand("weaver move-file '{}'", "rename");
      expect(result.reason).toContain("rename");
      expect(result.reason).toContain("move-file");
    });
  });

  describe("missing key arg", () => {
    it("does not match when a required key is absent from the JSON", () => {
      const result = matchWeaverCommand('weaver rename \'{"file":"src/a.ts"}\'', "rename", {
        newName: "bar",
      });
      expect(result.matched).toBe(false);
      expect(result.reason).toContain("missing key arg");
      expect(result.reason).toContain("newName");
    });
  });

  describe("wrong key arg value", () => {
    it("does not match when a key has the wrong value", () => {
      const result = matchWeaverCommand('weaver rename \'{"newName":"wrong"}\'', "rename", {
        newName: "bar",
      });
      expect(result.matched).toBe(false);
      expect(result.reason).toContain("wrong key arg value");
      expect(result.reason).toContain("newName");
      expect(result.reason).toContain("bar");
      expect(result.reason).toContain("wrong");
    });
  });

  describe("malformed JSON", () => {
    it("does not match when the JSON argument does not parse", () => {
      const result = matchWeaverCommand("weaver rename 'not-json'", "rename");
      expect(result.matched).toBe(false);
    });

    it("distinguishes malformed JSON from a non-weaver command in the failure reason", () => {
      const malformed = matchWeaverCommand("weaver rename 'not-json'", "rename");
      const noWeaver = matchWeaverCommand("grep -r foo .", "rename");
      expect(malformed.reason).toContain("JSON malformed");
      expect(noWeaver.reason).toContain("no weaver attempt");
    });
  });

  describe("no weaver attempt", () => {
    it("does not match a non-weaver command", () => {
      const result = matchWeaverCommand("grep -r userId src/", "rename");
      expect(result.matched).toBe(false);
      expect(result.reason).toContain("no weaver attempt");
    });

    it("includes the actual command in the failure reason", () => {
      const result = matchWeaverCommand("sed -i 's/old/new/g' file.ts", "rename");
      expect(result.reason).toContain("sed");
    });
  });

  describe("empty input", () => {
    it("does not match an empty command string", () => {
      const result = matchWeaverCommand("", "rename");
      expect(result.matched).toBe(false);
      expect(result.reason).toContain("no weaver attempt");
    });
  });
});
