/**
 * @file AdaptiveSampler 单元测试
 * @description 测试自适应降采样器的首次放行、间隔恢复、密集降采样和重置行为。
 * @module utils/log/tests/adaptive-sampler.test
 * @author Zhou Chenyu
 */

import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { AdaptiveSampler } from "../adaptive-sampler.js";

describe("AdaptiveSampler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("第一次采样始终放行", () => {
    const sampler = new AdaptiveSampler();
    expect(sampler.sample()).toBe(true);
  });

  test("间隔足够时恢复满采样", () => {
    const sampler = new AdaptiveSampler(50, 0);
    expect(sampler.sample()).toBe(true);

    jest.advanceTimersByTime(60);
    expect(sampler.sample()).toBe(true);
  });

  test("密集调用时部分放行", () => {
    const sampler = new AdaptiveSampler(10, 0.1);
    expect(sampler.sample()).toBe(true);

    let passed = 0;
    for (let i = 0; i < 100; i++) {
      if (sampler.sample()) passed++;
    }

    expect(passed).toBeLessThan(100);
    expect(passed).toBeGreaterThan(0);
  });

  test("minRate=0 时密集调用可能全丢弃", () => {
    const sampler = new AdaptiveSampler(10, 0);
    sampler.sample();

    let passed = 0;
    for (let i = 0; i < 50; i++) {
      if (sampler.sample()) passed++;
    }

    expect(passed).toBeLessThan(50);
  });

  test("reset 后恢复满采样", () => {
    const sampler = new AdaptiveSampler(10, 0);
    sampler.sample();

    for (let i = 0; i < 50; i++) sampler.sample();

    sampler.reset();
    expect(sampler.sample()).toBe(true);
  });
});
