import { describe, expect, it } from "vitest";
import { computeRate } from "./rate.js";

describe("computeRate", () => {
  describe("all trials pass", () => {
    it("returns rate 1, passed = total, not below alarm", () => {
      const result = computeRate([true, true, true]);
      expect(result.passed).toBe(3);
      expect(result.total).toBe(3);
      expect(result.rate).toBe(1);
      expect(result.belowAlarm).toBe(false);
    });
  });

  describe("at the 2/3 alarm floor (inclusive — not below)", () => {
    it("returns rate 2/3, not below alarm", () => {
      const result = computeRate([true, true, false]);
      expect(result.passed).toBe(2);
      expect(result.total).toBe(3);
      expect(result.rate).toBe(2 / 3);
      expect(result.belowAlarm).toBe(false);
    });
  });

  describe("below the alarm floor", () => {
    it("returns below alarm when 1 of 3 trials pass", () => {
      const result = computeRate([true, false, false]);
      expect(result.passed).toBe(1);
      expect(result.total).toBe(3);
      expect(result.rate).toBeCloseTo(1 / 3);
      expect(result.belowAlarm).toBe(true);
    });

    it("returns below alarm when no trials pass", () => {
      const result = computeRate([false, false, false]);
      expect(result.passed).toBe(0);
      expect(result.total).toBe(3);
      expect(result.rate).toBe(0);
      expect(result.belowAlarm).toBe(true);
    });
  });

  describe("empty result set", () => {
    it("returns zero rate and below alarm when no results are provided", () => {
      const result = computeRate([]);
      expect(result.passed).toBe(0);
      expect(result.total).toBe(0);
      expect(result.rate).toBe(0);
      expect(result.belowAlarm).toBe(true);
    });

    it("is distinguishable from 0/3 by total", () => {
      const empty = computeRate([]);
      const zeroOfThree = computeRate([false, false, false]);
      expect(empty.total).toBe(0);
      expect(zeroOfThree.total).toBe(3);
    });
  });
});
