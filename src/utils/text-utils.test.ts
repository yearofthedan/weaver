import { describe, expect, it } from "vitest";
import { applyTextEdits, lineColToOffset, offsetToLineCol } from "./text-utils.js";

describe("offsetToLineCol", () => {
  it.each([
    { content: "", offset: 0, line: 1, col: 1, desc: "offset 0 in empty string" },
    { content: "hello", offset: 0, line: 1, col: 1, desc: "offset 0 at start of file" },
    { content: "hello world", offset: 6, line: 1, col: 7, desc: "mid-line" },
    // "abc\ndef" — offset 3 is '\n' → still line 1, col 4
    { content: "abc\ndef", offset: 3, line: 1, col: 4, desc: "at the newline character itself" },
    // "abc\ndef" — offset 4 is 'd' → line 2, col 1
    { content: "abc\ndef", offset: 4, line: 2, col: 1, desc: "first char of second line" },
    // last char 'f' is at offset 6 → line 2, col 3
    { content: "abc\ndef", offset: 6, line: 2, col: 3, desc: "last char with no trailing newline" },
    // "a\nb\nc" — offset 4 is 'c' → line 3, col 1
    { content: "a\nb\nc", offset: 4, line: 3, col: 1, desc: "third line" },
  ])("$desc", ({ content, offset, line, col }) => {
    expect(offsetToLineCol(content, offset)).toEqual({ line, col });
  });

  it("handles multi-byte characters (emoji are 2 JS code units)", () => {
    // "hi 🎉 bye" — 🎉 occupies code units 3 and 4
    // offset 3 = first code unit of emoji → col 4 on line 1
    const s = "hi 🎉 bye";
    expect(offsetToLineCol(s, 3)).toEqual({ line: 1, col: 4 });
    // offset 5 = space after emoji → col 6
    expect(offsetToLineCol(s, 5)).toEqual({ line: 1, col: 6 });
  });
});

describe("lineColToOffset", () => {
  it.each([
    { content: "hello", line: 1, col: 1, offset: 0, desc: "start of file" },
    { content: "hello world", line: 1, col: 7, offset: 6, desc: "mid-line" },
    // "abc\ndef" — line 2, col 1 → offset 4
    { content: "abc\ndef", line: 2, col: 1, offset: 4, desc: "start of second line" },
    // "abc\ndef" — line 2, col 3 → offset 6
    { content: "abc\ndef", line: 2, col: 3, offset: 6, desc: "mid second line" },
  ])("$desc", ({ content, line, col, offset }) => {
    expect(lineColToOffset(content, line, col)).toBe(offset);
  });

  it("is the inverse of offsetToLineCol (round-trip)", () => {
    const content = "first line\nsecond line\nthird line";
    for (const offset of [0, 5, 11, 17, 23]) {
      const { line, col } = offsetToLineCol(content, offset);
      expect(lineColToOffset(content, line, col)).toBe(offset);
    }
  });

  it("throws a RangeError when line is out of range", () => {
    expect(() => lineColToOffset("one line", 5, 1)).toThrow(RangeError);
  });

  it("throws RangeError at the exact boundary (line count + 1)", () => {
    // "one line" has 1 line, so line=2 is the minimum out-of-range value.
    // Pins the >= operator: if changed to >, (line-1)==lines.length (1==1) would not throw.
    expect(() => lineColToOffset("one line", 2, 1)).toThrow(RangeError);
  });
});

describe("applyTextEdits", () => {
  it.each([
    { text: "hello", edits: [], expected: "hello", desc: "empty edit array" },
    {
      text: "hello world",
      edits: [{ span: { start: 6, length: 5 }, newText: "there" }],
      expected: "hello there",
      desc: "replace a span",
    },
    {
      text: "world",
      edits: [{ span: { start: 0, length: 0 }, newText: "hello " }],
      expected: "hello world",
      desc: "insert at start with zero-length span",
    },
    {
      text: "hello",
      edits: [{ span: { start: 5, length: 0 }, newText: "!" }],
      expected: "hello!",
      desc: "insert at end with zero-length span",
    },
    {
      text: "hello world",
      edits: [{ span: { start: 5, length: 6 }, newText: "" }],
      expected: "hello",
      desc: "delete a span with empty newText",
    },
    {
      text: "old",
      edits: [{ span: { start: 0, length: 3 }, newText: "brand new" }],
      expected: "brand new",
      desc: "replace the entire string",
    },
  ])("$desc", ({ text, edits, expected }) => {
    expect(applyTextEdits(text, edits)).toBe(expected);
  });

  it("applies multiple non-overlapping edits correctly", () => {
    // Replace "foo" at 0 and "baz" at 8 — both must be applied without offset drift
    expect(
      applyTextEdits("foo bar baz", [
        { span: { start: 0, length: 3 }, newText: "qux" },
        { span: { start: 8, length: 3 }, newText: "quux" },
      ]),
    ).toBe("qux bar quux");
  });

  it("applies edits regardless of input order (sorts descending)", () => {
    // Same as above but edits provided in reverse order
    expect(
      applyTextEdits("foo bar baz", [
        { span: { start: 8, length: 3 }, newText: "quux" },
        { span: { start: 0, length: 3 }, newText: "qux" },
      ]),
    ).toBe("qux bar quux");
  });

  it("applies later spans before earlier ones so a shorter replacement does not corrupt subsequent offsets", () => {
    // Edit at start=1 deletes 'X' (length 1 → 0 chars); edit at start=3 replaces 'YY' with 'Z'.
    // Edits are given in ascending order. If sort were removed or reversed to ascending,
    // the deletion at 1 would shift 'YY' from [3,4] to [2,3], causing the edit at
    // position 3 to land on the wrong character and produce "abYZ" instead of "abZ".
    expect(
      applyTextEdits("aXbYY", [
        { span: { start: 1, length: 1 }, newText: "" },
        { span: { start: 3, length: 2 }, newText: "Z" },
      ]),
    ).toBe("abZ");
  });
});
