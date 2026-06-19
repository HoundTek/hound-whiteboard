/**
 * @file KeyThrottle 单元测试
 * @description 测试按 key 节流的窗口控制、跳过计数、清空和自定义窗口行为。
 * @module utils/log/tests/key-throttle.test
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
import { KeyThrottle } from "../key-throttle.js";

describe("KeyThrottle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("相同 key 在窗口内第二次被节流", () => {
    const throttle = new KeyThrottle(200);
    expect(throttle.tryEmit("chunk-miss")).toBe(true);
    expect(throttle.tryEmit("chunk-miss")).toBe(false);
  });

  test("窗口过后恢复", () => {
    const throttle = new KeyThrottle(100);
    expect(throttle.tryEmit("key1")).toBe(true);
    expect(throttle.tryEmit("key1")).toBe(false);

    jest.advanceTimersByTime(150);
    expect(throttle.tryEmit("key1")).toBe(true);
  });

  test("不同 key 互不影响", () => {
    const throttle = new KeyThrottle(200);
    expect(throttle.tryEmit("a")).toBe(true);
    expect(throttle.tryEmit("b")).toBe(true);
    expect(throttle.tryEmit("a")).toBe(false);
    expect(throttle.tryEmit("b")).toBe(false);
  });

  test("skipCount 累计", () => {
    const throttle = new KeyThrottle(50);
    throttle.tryEmit("k");
    expect(throttle.skipCount("k")).toBe(0);
    throttle.tryEmit("k");
    expect(throttle.skipCount("k")).toBe(1);
    throttle.tryEmit("k");
    expect(throttle.skipCount("k")).toBe(2);
  });

  test("clear 清空所有状态", () => {
    const throttle = new KeyThrottle(200);
    throttle.tryEmit("a");
    throttle.tryEmit("b");
    throttle.clear();
    expect(throttle.tryEmit("a")).toBe(true);
    expect(throttle.tryEmit("b")).toBe(true);
  });

  test("可指定自定义窗口", () => {
    const throttle = new KeyThrottle(1000);
    expect(throttle.tryEmit("k", 50)).toBe(true);
    expect(throttle.tryEmit("k", 50)).toBe(false);
    jest.advanceTimersByTime(100);
    expect(throttle.tryEmit("k", 50)).toBe(true);
  });
});
