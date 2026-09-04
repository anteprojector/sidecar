import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { afterEach, beforeEach } from "vitest";

// Integration tests perform long runs of spawnSync and synchronous Git calls.
// Awaiting an already-resolved promise only runs microtasks, so back-to-back
// tests can otherwise starve Vitest's worker RPC replies past their 60s limit.
// Native immediates give I/O a turn without depending on fake timer state.
beforeEach(() => yieldToEventLoop());
afterEach(() => yieldToEventLoop());
