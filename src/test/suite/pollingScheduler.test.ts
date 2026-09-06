import * as assert from "assert";
import type { PollingContext, PollingDecision } from "../../features/polling/domain/adaptivePollingPolicy";
import {
  PollingScheduler,
  type PollingClock,
  type PollingLogger,
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
      await flushAsyncWork();
    }
    this.current = target;
    await flushAsyncWork();
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
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
    await flushAsyncWork();
    await clock.advanceBy(10);
    assert.strictEqual(calls, 2);
    scheduler.dispose();
  });

  test("continues scheduling after a failed run", async () => {
    const clock = new FakeClock();
    const scheduler = new PollingScheduler(clock, fixedDecision(10));
    let calls = 0;

    scheduler.register({
      key: "failure-recovery",
      context: baseContext,
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return { changed: false };
      },
    });

    await clock.advanceBy(0);
    assert.strictEqual(calls, 1);
    await clock.advanceBy(10);
    assert.strictEqual(calls, 2);
    scheduler.dispose();
  });

  test("logs registration and polling attempts with resource context", async () => {
    const clock = new FakeClock();
    const messages: string[] = [];
    const logger: PollingLogger = { debug: (message) => messages.push(message) };
    const scheduler = new PollingScheduler(clock, fixedDecision(2_500), logger);

    scheduler.register({
      key: "repo:owner/name:pr:42",
      context: baseContext,
      run: async () => ({ changed: false }),
    });

    await clock.advanceBy(0);

    assert.match(messages[0], /^\[polling\] registered /);
    assert.match(messages[0], /key=repo:owner\/name:pr:42/);

    const attempt = messages.find((message) => message.startsWith("[polling] attempt "));
    assert.ok(attempt);
    assert.match(attempt, /key=repo:owner\/name:pr:42/);
    assert.match(attempt, /resource=pull-request/);
    assert.match(attempt, /lifecycle=active/);
    assert.match(attempt, /visible=true/);
    assert.match(attempt, /windowActive=true/);
    assert.match(attempt, /unchanged=0/);
    assert.match(attempt, /delayMs=2500/);
    assert.match(attempt, /reason=test/);
    scheduler.dispose();
  });

  test("logs paused resources with their current unchanged count", async () => {
    const clock = new FakeClock();
    const messages: string[] = [];
    const logger: PollingLogger = { debug: (message) => messages.push(message) };
    const scheduler = new PollingScheduler(
      clock,
      () => ({ kind: "pause", reason: "editing" }),
      logger,
    );

    scheduler.register({
      key: "paused",
      context: baseContext,
      run: async () => ({ changed: false }),
    });
    await clock.advanceBy(0);

    const paused = messages.find((message) => message.startsWith("[polling] paused "));
    assert.ok(paused);
    assert.match(paused, /resource=pull-request/);
    assert.match(paused, /activity=idle/);
    assert.match(paused, /unchanged=0/);
    assert.match(paused, /reason=editing/);
    scheduler.dispose();
  });

  test("paused resources stay unscheduled until reconsidered", async () => {
    const clock = new FakeClock();
    let paused = true;
    let calls = 0;
    const scheduler = new PollingScheduler(clock, () =>
      paused
        ? { kind: "pause", reason: "editing" }
        : { kind: "poll", delayMs: 10, reason: "active" },
    );
    const handle = scheduler.register({
      key: "paused",
      context: baseContext,
      run: async () => {
        calls += 1;
        return { changed: false };
      },
    });

    await clock.advanceBy(0);
    assert.strictEqual(calls, 0);
    assert.strictEqual(clock.timerCount(), 0);

    await clock.advanceBy(10_000);
    assert.strictEqual(calls, 0);

    paused = false;
    handle.reconsider();
    assert.strictEqual(clock.timerCount(), 1);
    await clock.advanceBy(10);
    assert.strictEqual(calls, 1);
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

  test("accelerate during a run schedules one immediate follow-up", async () => {
    const clock = new FakeClock();
    const scheduler = new PollingScheduler(clock, fixedDecision(10_000));
    let calls = 0;
    let resolveRun: (() => void) | undefined;
    const handle = scheduler.register({
      key: "accelerated-in-flight",
      context: baseContext,
      run: () => {
        calls += 1;
        if (calls > 1) return Promise.resolve({ changed: true });
        return new Promise((resolve) => {
          resolveRun = () => resolve({ changed: false });
        });
      },
    });

    await clock.advanceBy(0);
    assert.strictEqual(calls, 1);
    handle.accelerate();
    await clock.advanceBy(1_000);
    assert.strictEqual(calls, 1);

    resolveRun?.();
    await flushAsyncWork();
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
