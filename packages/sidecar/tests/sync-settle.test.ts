import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/git.js", async (original) => ({
  ...await original<typeof import("../src/git.js")>(),
  branchExists: vi.fn(),
  ensureClean: vi.fn(),
  git: vi.fn(),
  isDirty: vi.fn(),
}));
vi.mock("../src/state.js", async (original) => ({
  ...await original<typeof import("../src/state.js")>(),
  logSidecarEvent: vi.fn(),
}));

import { branchExists, ensureClean, git, isDirty } from "../src/git.js";
import { logSidecarEvent } from "../src/state.js";
import { settleCheckouts } from "../src/sync.js";
import type { SidecarConfig } from "../src/config.js";

const config: SidecarConfig = {
  remote: "unused", path: "sidecar", branch: "main", inbox: "sidecar-inbox/{user}/{random}",
  resolve: "fork", redaction: "secrets", peer: "default",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(branchExists).mockReturnValue(false);
  vi.mocked(git).mockReturnValue({ status: 0, stdout: "", stderr: "" });
});

describe("best-effort sibling settling", () => {
  test("skips a sibling whose dirty check fails and continues without changing its policy", () => {
    vi.mocked(isDirty).mockImplementation((repo) => {
      if (repo === "bad-policy") throw new Error("sidecar redaction rules changed; run sidecar sync");
      return repo === "mid-edit";
    });

    expect(() => settleCheckouts("current", config, "inbox", ["bad-policy", "healthy", "mid-edit", "also-healthy"])).not.toThrow();

    expect(vi.mocked(isDirty).mock.calls.map(([repo]) => repo)).toEqual(["bad-policy", "healthy", "mid-edit", "also-healthy"]);
    expect(vi.mocked(git).mock.calls).toEqual([
      ["healthy", ["merge", "--ff-only", "main"], { check: false }],
      ["also-healthy", ["merge", "--ff-only", "main"], { check: false }],
    ]);
    expect(logSidecarEvent).toHaveBeenCalledWith("settle-skip", {
      sidecarPath: "bad-policy", message: "sidecar redaction rules changed; run sidecar sync",
    });
    expect(logSidecarEvent).toHaveBeenCalledWith("settle", { sidecarPath: "current", siblings: 2 });
  });

  test("continues after a sibling merge throws", () => {
    vi.mocked(git).mockImplementation((repo) => {
      if (repo === "gone") throw new Error("working directory is gone");
      return { status: 0, stdout: "", stderr: "" };
    });
    expect(() => settleCheckouts("current", config, "inbox", ["gone", "healthy"])).not.toThrow();
    expect(git).toHaveBeenCalledWith("healthy", ["merge", "--ff-only", "main"], { check: false });
    expect(logSidecarEvent).toHaveBeenCalledWith("settle", { sidecarPath: "current", siblings: 1 });
  });

  test("still fails when the current checkout cannot settle", () => {
    vi.mocked(branchExists).mockReturnValue(true);
    vi.mocked(ensureClean).mockImplementation(() => { throw new Error("current checkout is dirty"); });
    expect(() => settleCheckouts("current", config, "inbox", ["healthy"])).toThrow("current checkout is dirty");
    expect(isDirty).not.toHaveBeenCalled();
  });
});
