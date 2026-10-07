import { behaviorLog, type LogData } from "./utils";
import * as Lib from "./utils";

// ===========================================================================
export class BackgroundBehavior {
  debug(msg: LogData) {
    void behaviorLog(msg, "debug");
  }

  error(msg: LogData) {
    void behaviorLog(msg, "error");
  }

  log(msg: LogData, type = "info") {
    void behaviorLog(msg, type);
  }
}

// WIP: BehaviorRunner class allows for arbitrary behaviors outside of the
// library to be run through the BehaviorManager

export type EmptyObject = Record<string, never>;

export type Context<State, Opts = EmptyObject> = {
  Lib: typeof Lib;
  state: State;
  opts: Opts;
  log: (data: LogData, type?: string) => Promise<void>;
};

abstract class AbstractBehaviorBase<State, Opts = EmptyObject> {
  static readonly id: string;
  static isMatch: () => boolean;
  static init: () => {
    // TODO: type these
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts?: any;
  };

  abstract [Symbol.asyncIterator]?(): AsyncIterable<void>;

  abstract awaitPageLoad?: (ctx: Context<State, Opts>) => Promise<void>;
}

export abstract class AbstractBehavior<
  State,
  Opts = EmptyObject,
> extends AbstractBehaviorBase<State, Opts> {
  abstract run: (
    ctx: Context<State, Opts>,
  ) => AsyncIterable<{ state?: State; msg: string } | undefined>;
}

type StaticProps<T> = {
  [K in keyof T]: T[K];
};

type StaticBehaviorProps = StaticProps<typeof AbstractBehavior>;

// Non-abstract constructor type
type ConcreteBehaviorConstructor<State, Opts> = StaticBehaviorProps & {
  new (): AbstractBehavior<State, Opts>;
};

export class BehaviorRunner<State, Opts>
  extends BackgroundBehavior
  implements AbstractBehaviorBase<State, Opts>
{
  inst: AbstractBehavior<State, Opts>;
  behaviorProps: ConcreteBehaviorConstructor<State, Opts>;
  ctx: Context<State, Opts>;
  _running: Promise<void> | null;
  paused: Promise<void> | (() => Promise<void>) | null;
  _unpause: ((value: void | PromiseLike<void>) => void) | null;
  isSiteSpecific: boolean;

  get id() {
    return (this.inst.constructor as ConcreteBehaviorConstructor<State, Opts>)
      .id;
  }

  constructor(
    behavior: ConcreteBehaviorConstructor<State, Opts>,
    mainOpts = {},
    isSiteSpecific = true,
  ) {
    super();
    this.behaviorProps = behavior;
    this.inst = new behavior();
    this.isSiteSpecific = isSiteSpecific;

    if (
      typeof this.inst.run !== "function" ||
      this.inst.run.constructor.name !== "AsyncGeneratorFunction"
    ) {
      throw Error("Invalid behavior: missing `async run*` instance method");
    }

    let { state, opts } = behavior.init();
    state = state || {};
    opts = opts ? { ...opts, ...mainOpts } : mainOpts;

    const log = async (data: LogData, type?: string) =>
      this.wrappedLog(data, type);

    this.ctx = { Lib, state, opts, log };

    this._running = null;
    this.paused = null;
    this._unpause = null;
  }

  wrappedLog(data: LogData, type = "info") {
    let logData: Exclude<LogData, string>;
    if (typeof data === "string" || data instanceof String) {
      logData = { msg: data.toString() };
    } else {
      logData = data;
    }
    this.log(
      {
        ...logData,
        behavior: this.behaviorProps.id,
        siteSpecific: this.isSiteSpecific,
      },
      type,
    );
  }

  start() {
    this._running = this.run();
  }

  async done() {
    return this._running ? this._running : Promise.resolve();
  }

  async run() {
    try {
      for await (const step of this.inst.run(this.ctx)) {
        if (step) {
          this.wrappedLog(step);
        }
        if (this.paused) {
          await this.paused;
        }
      }
      this.debug({ msg: "done!", behavior: this.behaviorProps.id });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      this.error({
        msg: (e as Error).toString(),
        behavior: this.behaviorProps.id,
      });
    }
  }

  pause() {
    if (this.paused) {
      return;
    }
    this.paused = new Promise((resolve) => {
      this._unpause = resolve;
    });
  }

  unpause() {
    if (this._unpause) {
      this._unpause();
      this.paused = null;
      this._unpause = null;
    }
  }

  cleanup() { this.inst.cleanup?.(); }

  async awaitPageLoad() {
    if (this.inst.awaitPageLoad) {
      await this.inst.awaitPageLoad(this.ctx);
    }
  }

  static load() {
    if (self["__bx_behaviors"]) {
      self["__bx_behaviors"].load(this);
    } else {
      console.warn(
        `Could not load ${this.name} behavior: window.__bx_behaviors is not initialized`,
      );
    }
  }
}
