import { describe, expect, it } from "vitest";
import { boundaryTrialClean } from "./agentic-loop.js";
import type { ToolCall } from "./call-model.js";

const bashCall = (command: string): ToolCall => ({ name: "bash", arguments: { command } });

describe("boundaryTrialClean", () => {
  it.each([
    {
      name: "a non-weaver bash command with no skill load",
      skillMdRead: false,
      trail: [bashCall("ls -la /tmp/weaver-eval/src")],
      expected: true,
    },
    {
      name: "an empty trail with no skill load",
      skillMdRead: false,
      trail: [] as ToolCall[],
      expected: true,
    },
    {
      name: "a skill load with an otherwise empty trail",
      skillMdRead: true,
      trail: [] as ToolCall[],
      expected: false,
    },
    {
      name: "a weaver invocation for any subcommand",
      skillMdRead: false,
      trail: [bashCall('weaver move-file \'{"oldPath":"a.ts"}\'')],
      expected: false,
    },
  ])("returns $expected for $name", ({ skillMdRead, trail, expected }) => {
    expect(boundaryTrialClean({ skillMdRead, trail })).toBe(expected);
  });
});
