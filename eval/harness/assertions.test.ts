import { describe, expect, it } from "vitest";
import {
  extractBashCommands,
  isAnyWeaverInvocation,
  isWeaverInvocation,
  matchesExpectedCommand,
  matchWeaverCommand,
  weaverSubcommand,
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

    it("splits on a bare && with no surrounding whitespace", () => {
      expect(
        extractBashCommands([bashCall("weaver rename '{}'&&weaver search-text '{}'")]),
      ).toEqual(["weaver rename '{}'", "weaver search-text '{}'"]);
    });

    it("trims leading and trailing whitespace from a command", () => {
      expect(extractBashCommands([bashCall("  weaver rename '{}'  ")])).toEqual([
        "weaver rename '{}'",
      ]);
    });
  });

  describe("zero case", () => {
    it("returns empty array when no tool calls are present", () => {
      expect(extractBashCommands([])).toEqual([]);
    });

    it("returns empty array when no bash calls are present", () => {
      expect(extractBashCommands([otherCall("skill"), otherCall("grep")])).toEqual([]);
    });

    it("returns empty array when the command is an empty string", () => {
      expect(extractBashCommands([bashCall("")])).toEqual([]);
    });

    it("returns empty array when a whitespace-only command trims to empty", () => {
      expect(extractBashCommands([bashCall("   ")])).toEqual([]);
    });
  });

  describe("non-bash tool calls", () => {
    it("excludes a non-bash call by name even when its arguments carry a command field", () => {
      const grepWithCommandArg: ToolCall = {
        name: "grep",
        arguments: { command: "weaver rename '{}'" },
      };
      expect(extractBashCommands([grepWithCommandArg])).toEqual([]);
    });

    it("returns empty string for a bash call whose command argument is not a string", () => {
      const bashWithNonStringCommand: ToolCall = { name: "bash", arguments: { command: 123 } };
      expect(extractBashCommands([bashWithNonStringCommand])).toEqual([]);
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

    it.each([
      ["npx from weaver", "npx  weaver rename --file x"],
      ["pnpm from exec", "pnpm  exec weaver rename --file x"],
      ["exec from weaver", "pnpm exec  weaver rename --file x"],
      ["weaver from the subcommand", "weaver  rename --file x"],
    ])("matches when extra whitespace separates %s", (_label, command) => {
      expect(isAnyWeaverInvocation(command)).toBe(true);
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

describe("weaverSubcommand", () => {
  describe("matching forms", () => {
    it("extracts the subcommand from a bare weaver invocation", () => {
      expect(weaverSubcommand("weaver search-text '{}'")).toBe("search-text");
    });

    it("extracts the subcommand from an npx weaver prefix", () => {
      expect(weaverSubcommand("npx weaver move-file --oldPath a.ts")).toBe("move-file");
    });

    it("extracts the subcommand from a pnpm exec weaver prefix", () => {
      expect(weaverSubcommand('pnpm exec weaver rename \'{"newName":"bar"}\'')).toBe("rename");
    });

    it("returns the whole token, not a shorter subcommand it prefixes", () => {
      expect(weaverSubcommand("weaver renamer --file x")).toBe("renamer");
    });

    it.each([
      ["npx from weaver", "npx  weaver rename --file x"],
      ["pnpm from exec", "pnpm  exec weaver rename --file x"],
      ["exec from weaver", "pnpm exec  weaver rename --file x"],
      ["weaver from the subcommand", "weaver  rename --file x"],
    ])("extracts the subcommand when extra whitespace separates %s", (_label, command) => {
      expect(weaverSubcommand(command)).toBe("rename");
    });
  });

  describe("non-matching cases", () => {
    it("returns undefined for a non-weaver command", () => {
      expect(weaverSubcommand("mkdir -p /x")).toBeUndefined();
    });

    it("returns undefined for a command that only mentions weaver mid-string", () => {
      expect(weaverSubcommand("echo weaver search-text")).toBeUndefined();
    });

    it("returns undefined for an empty command string", () => {
      expect(weaverSubcommand("")).toBeUndefined();
    });

    it("returns undefined for weaver with no subcommand", () => {
      expect(weaverSubcommand("weaver")).toBeUndefined();
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

    it("does not carry a reason property on a successful match", () => {
      const result = matchWeaverCommand('weaver rename \'{"newName":"bar"}\'', "rename", {
        newName: "bar",
      });
      expect(Object.hasOwn(result, "reason")).toBe(false);
    });

    it.each([
      ["the subcommand from the quoted argument", 'weaver  rename \'{"newName":"bar"}\''],
      ["the JSON quote from the subcommand", 'weaver rename  \'{"newName":"bar"}\''],
      ["npx from weaver", 'npx  weaver rename \'{"newName":"bar"}\''],
      ["pnpm from exec", 'pnpm  exec weaver rename \'{"newName":"bar"}\''],
      ["exec from weaver", 'pnpm exec  weaver rename \'{"newName":"bar"}\''],
    ])("matches when extra whitespace separates %s", (_label, command) => {
      const result = matchWeaverCommand(command, "rename", { newName: "bar" });
      expect(result.matched).toBe(true);
    });

    it("parses JSON content containing spaces after colons and commas", () => {
      const result = matchWeaverCommand(
        'weaver rename \'{"file": "src/a.ts", "newName": "bar"}\'',
        "rename",
        { newName: "bar" },
      );
      expect(result.matched).toBe(true);
    });

    it("matches when trailing whitespace follows the closing quote", () => {
      const result = matchWeaverCommand('weaver rename \'{"newName":"bar"}\' ', "rename", {
        newName: "bar",
      });
      expect(result.matched).toBe(true);
    });

    it("parses single-quoted JSON containing a backslash-escaped inner quote directly, without the double-quote unescaping fallback", () => {
      const result = matchWeaverCommand(`weaver rename '{"newName":"say \\"hi\\""}'`, "rename", {
        newName: 'say "hi"',
      });
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

  describe("path key args", () => {
    it("accepts a workspace-relative path when the model cd'd into the workspace", () => {
      const result = matchWeaverCommand(
        'weaver move-directory \'{"oldPath":"src/utils","newPath":"src/lib/helpers"}\'',
        "move-directory",
        { oldPath: "/tmp/weaver-eval/src/utils" },
      );
      expect(result.matched).toBe(true);
    });

    it("accepts the absolute path form unchanged", () => {
      const result = matchWeaverCommand(
        'weaver move-directory \'{"oldPath":"/tmp/weaver-eval/src/utils"}\'',
        "move-directory",
        { oldPath: "/tmp/weaver-eval/src/utils" },
      );
      expect(result.matched).toBe(true);
    });

    it("rejects a different directory whose name is not a trailing segment", () => {
      const result = matchWeaverCommand(
        'weaver move-directory \'{"oldPath":"src/wrong"}\'',
        "move-directory",
        { oldPath: "/tmp/weaver-eval/src/utils" },
      );
      expect(result.matched).toBe(false);
      expect(result.outcome).toBe("wrong-args");
    });

    it("requires a segment boundary — a bare substring of the final segment does not match", () => {
      const result = matchWeaverCommand('weaver delete-file \'{"file":"ils.ts"}\'', "delete-file", {
        file: "/tmp/weaver-eval/src/utils.ts",
      });
      expect(result.matched).toBe(false);
    });

    it("applies suffix matching to the file key too, not just oldPath", () => {
      const result = matchWeaverCommand(
        'weaver delete-file \'{"file":"src/old-helper.ts"}\'',
        "delete-file",
        { file: "/tmp/weaver-eval/src/old-helper.ts" },
      );
      expect(result.matched).toBe(true);
    });

    it("falls back to exact equality for a non-string actual value (no coercion into a suffix match)", () => {
      // A model could emit a bare number; endsWith would coerce it and wrongly
      // match `/tmp/x/42`. The type guard prevents that.
      const result = matchWeaverCommand("weaver delete-file '{\"file\":42}'", "delete-file", {
        file: "/tmp/x/42",
      });
      expect(result.matched).toBe(false);
    });

    it("falls back to exact equality for a non-string expected value", () => {
      const result = matchWeaverCommand('weaver delete-file \'{"file":"x/42"}\'', "delete-file", {
        file: 42,
      });
      expect(result.matched).toBe(false);
    });

    it("keeps a slash-containing non-path key exact — a trailing segment does not match", () => {
      // `replacement` can legitimately contain `/`, so it must not be suffix-matched:
      // emitting "bar" for an expected "foo/bar" is a different replacement.
      const result = matchWeaverCommand(
        'weaver replace-text \'{"replacement":"bar"}\'',
        "replace-text",
        { replacement: "foo/bar" },
      );
      expect(result.matched).toBe(false);
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

    it("reports malformed JSON for a double-quoted argument that stays invalid after the escape-stripping retry", () => {
      const result = matchWeaverCommand('weaver rename "not-json-at-all"', "rename");
      expect(result.matched).toBe(false);
      expect(result.reason).toContain("JSON malformed");
    });

    it("does not rescue single-quoted malformed JSON via the double-quote unescaping fallback", () => {
      const result = matchWeaverCommand(`weaver rename '{\\"newName\\":\\"bar\\"}'`, "rename", {
        newName: "bar",
      });
      expect(result.matched).toBe(false);
      expect(result.reason).toContain("JSON malformed");
    });
  });

  describe("command format anchoring", () => {
    it("does not match weaver appearing mid-word without a real npx/pnpm prefix", () => {
      const result = matchWeaverCommand("xweaver rename '{}'", "rename");
      expect(result.matched).toBe(false);
    });

    it("does not match when unexpected content trails the closing quote", () => {
      const result = matchWeaverCommand(
        'weaver rename \'{"newName":"bar"}\' unexpected-trailer',
        "rename",
        { newName: "bar" },
      );
      expect(result.matched).toBe(false);
    });

    it("reports command format not recognised for an unquoted argument, distinct from no weaver attempt", () => {
      const result = matchWeaverCommand("weaver rename someUnquotedArg", "rename");
      expect(result.matched).toBe(false);
      expect(result.reason).toContain("command format not recognised");
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

  describe("outcome", () => {
    it("is 'correct' for a fully matching command", () => {
      const result = matchWeaverCommand('weaver rename \'{"newName":"accountId"}\'', "rename", {
        newName: "accountId",
      });
      expect(result.matched).toBe(true);
      expect(result.outcome).toBe("correct");
    });

    it("is 'wrong-args' when the JSON is well-formed but the value is wrong", () => {
      const result = matchWeaverCommand('weaver rename \'{"newName":"wrong"}\'', "rename", {
        newName: "accountId",
      });
      expect(result.outcome).toBe("wrong-args");
    });

    it("is 'wrong-args' when a required key is missing", () => {
      const result = matchWeaverCommand("weaver rename '{\"whoops\":true}'", "rename", {
        newName: "accountId",
      });
      expect(result.outcome).toBe("wrong-args");
    });

    it("is 'wrong-args' when the right subcommand is invoked with no argument at all", () => {
      const result = matchWeaverCommand("weaver rename", "rename", { newName: "accountId" });
      expect(result.outcome).toBe("wrong-args");
    });

    it("is 'wrong-args' when the argument is malformed JSON", () => {
      const result = matchWeaverCommand("weaver rename 'not-json'", "rename");
      expect(result.outcome).toBe("wrong-args");
    });

    it("is 'wrong-tool' when a different subcommand is invoked", () => {
      const result = matchWeaverCommand("weaver move-file '{}'", "rename");
      expect(result.outcome).toBe("wrong-tool");
    });

    it("is 'wrong-tool' when the command does not invoke weaver at all", () => {
      const result = matchWeaverCommand("grep -r userId src/", "rename");
      expect(result.outcome).toBe("wrong-tool");
    });

    it("is 'correct' if and only if matched, for the happy path", () => {
      const result = matchWeaverCommand('weaver rename \'{"newName":"accountId"}\'', "rename", {
        newName: "accountId",
      });
      expect(result.outcome === "correct").toBe(result.matched);
    });
  });
});

describe("matchesExpectedCommand", () => {
  it.each([
    {
      name: "is true for the right subcommand with matching key args",
      call: bashCall('weaver rename \'{"newName":"accountId"}\''),
      expectedCommand: "rename",
      keyArgs: { newName: "accountId" },
      expected: true,
    },
    {
      name: "is false when the subcommand is right but a key arg is wrong",
      call: bashCall('weaver rename \'{"newName":"wrong"}\''),
      expectedCommand: "rename",
      keyArgs: { newName: "accountId" },
      expected: false,
    },
    {
      name: "is false for a different subcommand",
      call: bashCall('weaver move-file \'{"oldPath":"a.ts"}\''),
      expectedCommand: "rename",
      keyArgs: undefined,
      expected: false,
    },
    {
      name: "is false for a non-bash call regardless of its arguments",
      call: otherCall("weaver-refactor"),
      expectedCommand: "rename",
      keyArgs: undefined,
      expected: false,
    },
    {
      name: "finds a match inside a &&-chained command",
      call: bashCall(`cd /tmp/weaver-eval && weaver rename '{"newName":"accountId"}'`),
      expectedCommand: "rename",
      keyArgs: { newName: "accountId" },
      expected: true,
    },
    {
      name: "is false when the call's JSON argument does not parse",
      call: bashCall("weaver rename 'not-json'"),
      expectedCommand: "rename",
      keyArgs: undefined,
      expected: false,
    },
  ])("$name", ({ call, expectedCommand, keyArgs, expected }) => {
    expect(matchesExpectedCommand(call, expectedCommand, keyArgs)).toBe(expected);
  });
});
