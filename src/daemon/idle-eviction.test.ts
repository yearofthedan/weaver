import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startIdleTimer } from "./idle-eviction.js";

describe("startIdleTimer", () => {
  let now: number;

  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeNow(): number {
    return now;
  }

  function advance(ms: number): void {
    now += ms;
    vi.advanceTimersByTime(ms);
  }

  it("calls evict after the idle timeout is reached", () => {
    const evict = vi.fn();
    startIdleTimer({ now: fakeNow, evict, timeoutMs: 100, intervalMs: 10 });

    advance(90);
    expect(evict).not.toHaveBeenCalled();

    advance(20);
    expect(evict).toHaveBeenCalledOnce();
  });

  it("does not call evict before the timeout has elapsed", () => {
    const evict = vi.fn();
    startIdleTimer({ now: fakeNow, evict, timeoutMs: 100, intervalMs: 10 });

    advance(99);

    expect(evict).not.toHaveBeenCalled();
  });

  it("resets the idle countdown when reset is called", () => {
    const evict = vi.fn();
    const timer = startIdleTimer({ now: fakeNow, evict, timeoutMs: 100, intervalMs: 10 });

    advance(90);
    timer.reset();

    advance(50);
    expect(evict).not.toHaveBeenCalled();

    advance(60);
    expect(evict).toHaveBeenCalledOnce();
  });

  it("stop prevents evict from ever being called", () => {
    const evict = vi.fn();
    const timer = startIdleTimer({ now: fakeNow, evict, timeoutMs: 100, intervalMs: 10 });

    timer.stop();

    advance(200);
    expect(evict).not.toHaveBeenCalled();
  });

  it("uses default timeout of 5 minutes and interval of 60 seconds when not specified", () => {
    const evict = vi.fn();
    startIdleTimer({ now: fakeNow, evict });

    advance(4 * 60 * 1000 + 59 * 1000);
    expect(evict).not.toHaveBeenCalled();

    advance(2_000);
    expect(evict).toHaveBeenCalledOnce();
  });

  it("does not fire again after eviction until reset is called", () => {
    const evict = vi.fn();
    const timer = startIdleTimer({ now: fakeNow, evict, timeoutMs: 100, intervalMs: 10 });

    advance(110);
    expect(evict).toHaveBeenCalledOnce();

    advance(200);
    expect(evict).toHaveBeenCalledOnce();

    timer.reset();

    advance(110);
    expect(evict).toHaveBeenCalledTimes(2);
  });
});
