import {
  adaptivePollingDecision,
  type PollingContext,
  type PollingDecision,
} from "../domain/adaptivePollingPolicy";

export interface PollingClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PollingRunResult {
  changed: boolean;
}

export interface PollingRegistration {
  key: string;
  context(): Omit<PollingContext, "unchangedCount" | "inFlight">;
  run(): Promise<PollingRunResult>;
}

interface ScheduledResource {
  registration: PollingRegistration;
  unchangedCount: number;
  inFlight: boolean;
  nextRunAt: number;
  disposed: boolean;
}

export interface PollingRegistrationHandle {
  dispose(): void;
  accelerate(): void;
}

export class PollingScheduler {
  private readonly resources = new Map<string, ScheduledResource>();
  private timer: unknown | undefined;
  private disposed = false;

  constructor(
    private readonly clock: PollingClock,
    private readonly decide: (context: PollingContext) => PollingDecision =
      adaptivePollingDecision,
  ) {}

  register(registration: PollingRegistration): PollingRegistrationHandle {
    if (this.disposed) throw new Error("PollingScheduler is disposed.");
    if (this.resources.has(registration.key)) {
      throw new Error(`Polling resource already registered: ${registration.key}`);
    }

    const resource: ScheduledResource = {
      registration,
      unchangedCount: 0,
      inFlight: false,
      nextRunAt: this.clock.now(),
      disposed: false,
    };
    this.resources.set(registration.key, resource);
    this.rescheduleTimer();

    return {
      dispose: () => this.unregister(registration.key),
      accelerate: () => this.accelerate(registration.key),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) {
      this.clock.clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.resources.clear();
  }

  private unregister(key: string): void {
    const resource = this.resources.get(key);
    if (!resource) return;
    resource.disposed = true;
    this.resources.delete(key);
    this.rescheduleTimer();
  }

  private accelerate(key: string): void {
    const resource = this.resources.get(key);
    if (!resource || resource.inFlight) return;
    resource.unchangedCount = 0;
    resource.nextRunAt = this.clock.now();
    this.rescheduleTimer();
  }

  private rescheduleTimer(): void {
    if (this.disposed) return;
    if (this.timer !== undefined) {
      this.clock.clearTimeout(this.timer);
      this.timer = undefined;
    }

    let earliest: number | undefined;
    for (const resource of this.resources.values()) {
      if (resource.disposed || resource.inFlight) continue;
      earliest =
        earliest === undefined
          ? resource.nextRunAt
          : Math.min(earliest, resource.nextRunAt);
    }
    if (earliest === undefined) return;

    const delayMs = Math.max(0, earliest - this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      void this.runDueResources();
    }, delayMs);
  }

  private async runDueResources(): Promise<void> {
    if (this.disposed) return;
    const now = this.clock.now();
    const due = [...this.resources.values()].filter(
      (resource) => !resource.disposed && !resource.inFlight && resource.nextRunAt <= now,
    );

    await Promise.all(due.map((resource) => this.runResource(resource)));
    this.rescheduleTimer();
  }

  private async runResource(resource: ScheduledResource): Promise<void> {
    if (resource.disposed || resource.inFlight) return;

    const context = resource.registration.context();
    const decision = this.decide({
      ...context,
      unchangedCount: resource.unchangedCount,
      inFlight: resource.inFlight,
    });

    if (decision.kind === "pause") {
      resource.nextRunAt = this.clock.now() + 1_000;
      return;
    }

    resource.inFlight = true;
    try {
      const result = await resource.registration.run();
      if (resource.disposed) return;
      resource.unchangedCount = result.changed ? 0 : resource.unchangedCount + 1;
    } finally {
      resource.inFlight = false;
      if (!resource.disposed) {
        const nextDecision = this.decide({
          ...resource.registration.context(),
          unchangedCount: resource.unchangedCount,
          inFlight: false,
        });
        resource.nextRunAt =
          this.clock.now() +
          (nextDecision.kind === "poll" ? nextDecision.delayMs : 1_000);
      }
    }
  }
}
