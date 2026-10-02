import { describe, expect, it } from "vitest";

import { jobCountLabel } from "./labels";

describe("jobCountLabel", () => {
  it("shows the empty state when the last job is gone", () => {
    expect(jobCountLabel(0)).toBe("Nenhum job ainda");
  });

  it("counts the remaining jobs", () => {
    expect(jobCountLabel(1)).toBe("1 job");
    expect(jobCountLabel(2)).toBe("2 jobs");
  });
});
