import {
  type BoundaryCase,
  type CaseEntry,
  type Exposure,
  type FrontLoadedCase,
  isBoundaryCase,
  isFrontLoadedCase,
  type ProgressiveOpCase,
} from "../cases/cases.js";
import { commandPrompt } from "../cases/command-prompt.js";
import { type AgenticLoopParams, resolveCannedResult } from "./agentic-loop.js";
import { matchesExpectedCommand } from "./assertions.js";
import type { ChatMessage, ToolCall } from "./call-model.js";
import { buildClutterSystemPrompt } from "./clutter.js";
import { isCleanMode } from "./config.js";
import { buildAvailableSkillsPrompt, classifySkillReach, readSkillFile } from "./context.js";
import { loadFixture } from "./fixtures.js";
import { isMutatingCompetitor } from "./grade.js";
import { buildHabitMomentumSeed, buildMomentumPreSteps, buildSeedFollowup } from "./seed.js";
import { BASH_TOOL, rateLaneTools, SKILL_TOOL } from "./tools.js";

/** Two-hop trajectory budget: Read SKILL.md → optional precursor → weaver bash call. */
export const PROGRESSIVE_MAX_STEPS = 6;
/** The skill body is already in context, so a front-loaded trial only needs room for a convention-stumble retry plus the real call. */
export const FRONT_LOADED_MAX_STEPS = 3;

/**
 * Builds the seed conversation for a case's `momentumTurns`, defaulting to a
 * single pre-step when the field is absent. Clean mode (`WEAVER_EVAL_CLEAN`)
 * drops momentum turns entirely, regardless of what the case requests.
 */
export function seedForCase(c: CaseEntry): ChatMessage[] {
  return buildHabitMomentumSeed(c.task, isCleanMode() ? 0 : (c.momentumTurns ?? 1));
}

/**
 * The system-prompt content for an exposure: host scaffolding clutter (dropped
 * entirely under `WEAVER_EVAL_CLEAN`) plus, for the progressive exposure only,
 * the `<available_skills>` block a real host would expose — front-loaded
 * exposure carries the skill bodies in the user turn instead, via
 * {@link commandPrompt}, so it needs no skills block. Returns `""` when there
 * is nothing to say (front-loaded, clean mode) — the caller omits the system
 * message entirely rather than sending an empty one.
 */
export function systemPromptFor(exposure: Exposure): string {
  const clutter = isCleanMode() ? "" : buildClutterSystemPrompt();
  if (exposure !== "progressive") return clutter;
  return clutter ? `${clutter}\n\n${buildAvailableSkillsPrompt()}` : buildAvailableSkillsPrompt();
}

function systemMessage(exposure: Exposure): ChatMessage[] {
  const content = systemPromptFor(exposure);
  return content ? [{ role: "system", content }] : [];
}

/**
 * Resolves the canned result for a progressive-exposure call: a skill reach
 * (load or tool-style) feeds back the skill's real SKILL.md body, an
 * unrecognized `Skill()` name gets a host-style unknown-skill error, and
 * anything else falls through to {@link resolveCannedResult} against the
 * lane's declared tools — a hallucinated tool name still gets the generic
 * "no such tool" error, a declared tool its canned result.
 */
function resolveProgressiveCannedResult(
  call: ToolCall,
  declaredToolNames: readonly string[],
  caseResults?: Record<string, string>,
): string {
  const reach = classifySkillReach(call);
  if (reach !== undefined) {
    return readSkillFile(reach.skill);
  }
  if (call.name === "Skill") {
    return `Error: unknown skill "${String(call.arguments.skill ?? "")}".`;
  }
  return resolveCannedResult(call, declaredToolNames, caseResults);
}

/**
 * Builds the task-turn messages for a front-loaded case: momentum pre-steps
 * (dropped under clean mode), the task wrapped in {@link commandPrompt} as the
 * single user turn, and — for a two-step case — the scripted step-1 exchange
 * appended after it. Composed explicitly rather than via
 * {@link buildHabitMomentumSeed}/`buildSeedMessages` directly: both of those
 * end or begin with the task turn, so chaining them naively would duplicate
 * or misorder it.
 */
function frontLoadedTaskMessages(c: FrontLoadedCase): ChatMessage[] {
  const momentum = isCleanMode() ? [] : buildMomentumPreSteps(c.momentumTurns ?? 1);
  const taskMessage: ChatMessage = { role: "user", content: commandPrompt(c.task) };
  if (!c.seed) {
    return [...momentum, taskMessage];
  }
  const followup = buildSeedFollowup(c.seed.step1Command, loadFixture(c.seed.fixture));
  return [...momentum, taskMessage, ...followup];
}

function buildProgressiveConfig(
  c: ProgressiveOpCase | BoundaryCase,
): Omit<AgenticLoopParams, "step"> {
  const tools = [SKILL_TOOL, ...rateLaneTools()];
  const declaredToolNames = tools.map((t) => t.function.name);
  const messages: ChatMessage[] = [...systemMessage("progressive"), ...seedForCase(c)];
  const isSkillMdRead = (call: ToolCall) => classifySkillReach(call)?.via === "load";
  const isSkillCalledAsTool = (call: ToolCall) => classifySkillReach(call)?.via === "tool";
  const cannedResultFor = (call: ToolCall) =>
    resolveProgressiveCannedResult(call, declaredToolNames, c.cannedResults);

  if (isBoundaryCase(c)) {
    return {
      messages,
      tools,
      matches: () => false,
      isSkillMdRead,
      isSkillCalledAsTool,
      maxSteps: PROGRESSIVE_MAX_STEPS,
      cannedResultFor,
    };
  }

  const { command, keyArgs } = c.expect;
  return {
    messages,
    tools,
    matches: (call) => matchesExpectedCommand(call, command, keyArgs),
    hardFails: (call) => isMutatingCompetitor(call, command),
    isSkillMdRead,
    isSkillCalledAsTool,
    maxSteps: PROGRESSIVE_MAX_STEPS,
    cannedResultFor,
  };
}

function buildFrontLoadedConfig(c: FrontLoadedCase): Omit<AgenticLoopParams, "step"> {
  const tools = [BASH_TOOL];
  const declaredToolNames = tools.map((t) => t.function.name);
  const messages: ChatMessage[] = [...systemMessage("front-loaded"), ...frontLoadedTaskMessages(c)];
  const { command, keyArgs } = c.expect;

  return {
    messages,
    tools,
    matches: (call) => matchesExpectedCommand(call, command, keyArgs),
    hardFails: (call) => isMutatingCompetitor(call, command),
    // No skill tool is declared and the skill body is already in context, so
    // there is no navigation call to distinguish from an operation call —
    // an undeclared Skill() call is graded as any other hallucinated tool.
    isSkillMdRead: () => false,
    maxSteps: FRONT_LOADED_MAX_STEPS,
    cannedResultFor: (call) => resolveCannedResult(call, declaredToolNames, c.cannedResults),
  };
}

/**
 * Assembles everything {@link import("./agentic-loop.js").runAgenticLoop}
 * needs to run one trial for `c`, except the model transport itself — messages
 * (system prompt + seed), tool set, pass/hard-fail predicates, step budget,
 * and the canned-result resolver, all branched on the case's exposure per the
 * table in the eval design doc.
 */
export function buildTrialConfig(c: CaseEntry): Omit<AgenticLoopParams, "step"> {
  return isFrontLoadedCase(c) ? buildFrontLoadedConfig(c) : buildProgressiveConfig(c);
}
