import { describe, expect, it } from "vitest";
import { applyTextEdits, lineColToOffset, offsetToLineCol } from "../../src/utils/text-utils.js";

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

describe("lineColToOffset", () => {
  it("returns offset 0 for line 1 col 1", () => {
    expect(lineColToOffset("hello", 1, 1)).toBe(0);
  });

  it("returns correct offset mid-line", () => {
    expect(lineColToOffset("hello world", 1, 7)).toBe(6);
  });

  it("returns correct offset at start of second line", () => {
    // "abc\ndef" — line 2, col 1 → offset 4
    expect(lineColToOffset("abc\ndef", 2, 1)).toBe(4);
  });

  it("returns correct offset mid second line", () => {
    // "abc\ndef" — line 2, col 3 → offset 6
    expect(lineColToOffset("abc\ndef", 2, 3)).toBe(6);
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
