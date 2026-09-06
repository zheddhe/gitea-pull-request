import * as assert from "assert";
import type { PollingContext, PollingDecision } from "../../features/polling/domain/adaptivePollingPolicy";
import {
  PollingScheduler,
  type PollingClock,
} from "../../features/polling/services/pollingScheduler";

interface TimerEntry {
  id: number;
  at: number;
  callback: () => void;
}

class FakeClock implements PollingClock {
  private current = 0;
  private nextId = 1;
  private timers = new Map<number, TimerEntry>();

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { id, at: this.current + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  timerCount(): number {
    return this.timers.size;
  }

  async advanceBy(ms: number): Promise<void> {
    const target = this.current + ms;
    while (true) {
      const next = [...this.timers.values()]
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.current = next.at;
      this.timers.delete(next.id);
      next.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.current = target;
    await Promise.resolve();
  }
}

function baseContext(): Omit<PollingContext, "unchangedCount" | "inFlight"> {
  return {
    resourceKind: "pull-request",
    windowActive: true,
    visible: true,
    activity: "idle",
    lifecycle: "active",
  };
}

const fixedDecision = (delayMs: number) =>
  (_context: PollingContext): PollingDecision => ({
    kind: "poll",
    delayMs,
    reason: "test",
  });

suite("PollingScheduler", () => {
  test("uses one central timer for multiple resources", () => {
    const clock = new FakeClock();
    const scheduler = new PollingScheduler(clock, fixedDecision(1_000));

    scheduler.register({ key: "a", context: baseContext, run: async () => ({ changed: false }) });
    scheduler.register({ key: "b", context: baseContext, run: async () => ({ changed: false }) });

    assert.strictEqual(clock.timerCount(), 1);
    scheduler.dispose();
  });

  test("rejects duplicate resource keys", () => {
    const clock = new FakeClock();
    const scheduler = new PollingScheduler(clock, fixedDecision(1_000));
    const registration = { key: "same", context: baseContext, run: async () => ({ changed: false }) };

    scheduler.register(registration);
    assert.throws(() => scheduler.register(registration), /already registered/);
    scheduler.dispose();
  });

  test("never starts the same resource concurrently", async () => {
    const clock = new FakeClock();
    const scheduler = new PollingScheduler(clock, fixedDecision(10));
    let calls = 0;
    let resolveRun: (() => void) | undefined;

    scheduler.register({
      key: "single-flight",
      context: baseContext,
      run: () => {
        calls += 1;
        return new Promise((resolve) => {
          resolveRun = () => resolve({ changed: false });
        });
      },
    });

    await clock.advanceBy(0);
    await clock.advanceBy(100);
    assert.strictEqual(calls, 1);

    resolveRun?.();
    await Promise.resolve();
    await Promise.resolve();
    await clock.advanceBy(10);
    assert.strictEqual(calls, 2);
    scheduler.dispose();
  });

  test("accelerate schedules an immediate run", async () => {
    const clock = new FakeClock();
    const scheduler = new PollingScheduler(clock, fixedDecision(10_000));
    let calls = 0;
    const handle = scheduler.register({
      key: "accelerated",
      context: baseContext,
      run: async () => {
        calls += 1;
        return { changed: true };
      },
    });

    await clock.advanceBy(0);
    assert.strictEqual(calls, 1);
    await clock.advanceBy(1_000);
    handle.accelerate();
    await clock.advanceBy(0);
    assert.strictEqual(calls, 2);
    scheduler.dispose();
  });

  test("disposing a registration removes it from future scheduling", async () => {
    const clock = new FakeClock();
    const scheduler = new PollingScheduler(clock, fixedDecision(10));
    let calls = 0;
    const handle = scheduler.register({
      key: "disposable",
      context: baseContext,
      run: async () => {
        calls += 1;
        return { changed: false };
      },
    });

    await clock.advanceBy(0);
    assert.strictEqual(calls, 1);
    handle.dispose();
    await clock.advanceBy(100);
    assert.strictEqual(calls, 1);
    scheduler.dispose();
  });
});
