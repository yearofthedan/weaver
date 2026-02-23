import { describe, expect, it } from "vitest";
import { applyTextEdits, offsetToLineCol } from "../../src/engines/text-utils.js";

describe("offsetToLineCol", () => {
  it("returns line 1 col 1 for offset 0 in empty string", () => {
    expect(offsetToLineCol("", 0)).toEqual({ line: 1, col: 1 });
  });

  it("returns line 1 col 1 for offset 0 at start of file", () => {
    expect(offsetToLineCol("hello", 0)).toEqual({ line: 1, col: 1 });
  });

  it("returns correct position mid-line", () => {
    expect(offsetToLineCol("hello world", 6)).toEqual({ line: 1, col: 7 });
  });

  it("returns correct position at the newline character itself", () => {
    // "abc\ndef" — offset 3 is '\n' → still line 1, col 4
    expect(offsetToLineCol("abc\ndef", 3)).toEqual({ line: 1, col: 4 });
  });

  it("returns correct position on second line after newline", () => {
    // "abc\ndef" — offset 4 is 'd' → line 2, col 1
    expect(offsetToLineCol("abc\ndef", 4)).toEqual({ line: 2, col: 1 });
  });

  it("returns correct position at last char (no trailing newline)", () => {
    const s = "abc\ndef";
    // last char 'f' is at offset 6 → line 2, col 3
    expect(offsetToLineCol(s, s.length - 1)).toEqual({ line: 2, col: 3 });
  });

  it("handles three lines", () => {
    // "a\nb\nc" — offset 4 is 'c' → line 3, col 1
    expect(offsetToLineCol("a\nb\nc", 4)).toEqual({ line: 3, col: 1 });
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

describe("applyTextEdits", () => {
  it("returns text unchanged with empty edit array", () => {
    expect(applyTextEdits("hello", [])).toBe("hello");
  });

  it("replaces a span in the middle", () => {
    expect(
      applyTextEdits("hello world", [{ span: { start: 6, length: 5 }, newText: "there" }]),
    ).toBe("hello there");
  });

  it("inserts at start with zero-length span", () => {
    expect(applyTextEdits("world", [{ span: { start: 0, length: 0 }, newText: "hello " }])).toBe(
      "hello world",
    );
  });

  it("inserts at end with zero-length span", () => {
    expect(applyTextEdits("hello", [{ span: { start: 5, length: 0 }, newText: "!" }])).toBe(
      "hello!",
    );
  });

  it("deletes a span with empty newText", () => {
    expect(applyTextEdits("hello world", [{ span: { start: 5, length: 6 }, newText: "" }])).toBe(
      "hello",
    );
  });

  it("replaces the entire string", () => {
    expect(applyTextEdits("old", [{ span: { start: 0, length: 3 }, newText: "brand new" }])).toBe(
      "brand new",
    );
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
});
