import { describe, expect, it } from "vitest";
import { cn, truncate } from "@/lib/utils";

describe("utils", () => {
  it("cn merges classes", () => {
    expect(cn("a", false && "b", "c")).toContain("a");
    expect(cn("px-2", "px-4")).toContain("px-4");
  });

  it("truncate short and long", () => {
    expect(truncate("hi", 10)).toBe("hi");
    expect(truncate("abcdefghij", 5)).toBe("abcde…");
    expect(truncate(null)).toBe("");
  });
});
