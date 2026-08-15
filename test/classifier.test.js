import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBranch } from "../src/classifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocksPath = path.resolve(__dirname, "fixtures/github-api-mocks.json");
const mocks = JSON.parse(fs.readFileSync(mocksPath, "utf8"));

describe("classifier module", () => {
  it("classifies feature/normal-merge as merged", () => {
    const mock = mocks["feature/normal-merge"];
    const result = classifyBranch(mock);
    expect(result.status).toBe("merged");
    expect(result.prNumber).toBe(101);
  });

  it("classifies feature/squash-merge as merged (crucial squash-merge case)", () => {
    const mock = mocks["feature/squash-merge"];
    const result = classifyBranch(mock);
    expect(result.status).toBe("merged");
    expect(result.prNumber).toBe(102);
  });

  it("classifies feature/closed-no-merge as closed", () => {
    const mock = mocks["feature/closed-no-merge"];
    const result = classifyBranch(mock);
    expect(result.status).toBe("closed");
    expect(result.prNumber).toBe(103);
  });

  it("classifies feature/still-open as open", () => {
    const mock = mocks["feature/still-open"];
    const result = classifyBranch(mock);
    expect(result.status).toBe("open");
    expect(result.prNumber).toBe(104);
  });

  it("classifies feature/no-pr as no-pr", () => {
    const mock = mocks["feature/no-pr"];
    const result = classifyBranch(mock);
    expect(result.status).toBe("no-pr");
    expect(result.prNumber).toBeNull();
  });

  it("classifies feature/unpushed-work with no PR as no-pr", () => {
    const mock = mocks["feature/unpushed-work"];
    const result = classifyBranch(mock);
    expect(result.status).toBe("no-pr");
    expect(result.prNumber).toBeNull();
  });

  it("classifies GitHub REST API array format with merged_at timestamp as merged", () => {
    const apiResponse = [
      {
        number: 42,
        state: "closed",
        merged_at: "2026-08-10T12:00:00Z",
      },
    ];
    const result = classifyBranch(apiResponse);
    expect(result.status).toBe("merged");
    expect(result.prNumber).toBe(42);
  });

  it("flags ambiguous matches (>1 PR) as needs-review with reason 'multiple PRs matched'", () => {
    const ambiguousResponse = [
      { number: 10, state: "open" },
      { number: 11, state: "closed", merged_at: "2026-08-10T12:00:00Z" },
    ];
    const result = classifyBranch(ambiguousResponse);
    expect(result.status).toBe("needs-review");
    expect(result.reason).toBe("multiple PRs matched");
    expect(result.prNumber).toBeNull();
  });

  it("flags unrecognized PR state as needs-review with reason identifying the state", () => {
    const unrecognizedResponse = [
      { number: 105, state: "unknown_state" },
    ];
    const result = classifyBranch(unrecognizedResponse);
    expect(result.status).toBe("needs-review");
    expect(result.reason).toContain("unrecognized PR state: unknown_state");
  });

  it("classifies empty array as no-pr", () => {
    const result = classifyBranch([]);
    expect(result.status).toBe("no-pr");
    expect(result.prNumber).toBeNull();
  });
});
