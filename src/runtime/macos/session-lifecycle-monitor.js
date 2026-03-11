import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class SessionLifecycleMonitor {
  constructor({
    scriptPath = resolve(process.cwd(), "src/runtime/macos/power-events.swift"),
    onEvent = async () => {},
    onError = console.error,
    logger = NOOP_LOGGER,
  } = {}) {
    this.scriptPath = scriptPath;
    this.onEvent = onEvent;
    this.onError = onError;
    this.logger = logger;
    this.child = null;
    this.stdout = null;
    this.stderr = null;
  }

  async start() {
    if (process.platform !== "darwin") {
      this.logger.debug("lifecycle.monitor.skipped", {
        reason: "unsupported_platform",
        platform: process.platform,
      });
      return null;
    }

    this.child = spawn("/usr/bin/xcrun", ["swift", this.scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.stdout = createInterface({ input: this.child.stdout });
    this.stderr = createInterface({ input: this.child.stderr });

    this.stdout.on("line", (line) => {
      void this.#handleStdoutLine(line);
    });
    this.stderr.on("line", (line) => {
      this.logger.error("lifecycle.monitor.stderr", {
        line,
      });
    });
    this.child.on("error", (error) => {
      this.onError(error);
    });
    this.child.on("exit", (code, signal) => {
      this.logger.debug("lifecycle.monitor.exit", {
        code,
        signal,
      });
    });

    this.logger.debug("lifecycle.monitor.started", {
      scriptPath: this.scriptPath,
    });
    return this.child;
  }

  stop() {
    this.stdout?.close();
    this.stderr?.close();

    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  async #handleStdoutLine(line) {
    try {
      const payload = JSON.parse(line);

      if (!payload?.event || payload.event === "monitor_started") {
        return;
      }

      await this.onEvent(payload.event);
    } catch (error) {
      this.logger.error("lifecycle.monitor.parse_error", {
        line,
        message: error.message,
      });
      this.onError(error);
    }
  }
}
