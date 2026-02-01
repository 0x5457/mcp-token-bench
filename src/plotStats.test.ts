import { describe, expect, it } from "vitest";
import { meanStd, wilsonInterval } from "./plotStats.js";

describe("meanStd", () => {
  it("returns zeros for empty input", () => {
    expect(meanStd([])).toEqual({ mean: 0, std: 0 });
  });

  it("computes mean and std for simple values", () => {
    const result = meanStd([1, 2, 3, 4]);
    expect(result.mean).toBeCloseTo(2.5, 6);
    expect(result.std).toBeCloseTo(1.1180339887, 6);
  });
});

describe("wilsonInterval", () => {
  it("returns zeros when total is zero", () => {
    expect(wilsonInterval(0, 0)).toEqual({ center: 0, low: 0, high: 0 });
  });

  it("bounds interval within [0,1]", () => {
    const { low, high } = wilsonInterval(5, 10);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
  });

  it("centers around sample proportion", () => {
    const { center } = wilsonInterval(8, 10);
    expect(center).toBeGreaterThan(0.7);
    expect(center).toBeLessThan(0.9);
  });
});
