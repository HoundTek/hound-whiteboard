/**
 * @file LogRateTracker 单元测试
 * @description 测试速率追踪器的记录、窗口过滤、subscribe 连接和清空功能。
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
import { LogRateTracker } from "../rate-tracker.js";
import { LogBus } from "../log-bus.js";

describe("LogRateTracker", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("记录并返回速率", () => {
    const tracker = new LogRateTracker(1000);

    tracker.record({ logger: "Test", timestamp: 1000 });
    tracker.record({ logger: "Test", timestamp: 1100 });
    tracker.record({ logger: "Test", timestamp: 1200 });

    const rates = tracker.getRates();
    expect(rates).toHaveLength(1);
    expect(rates[0].name).toBe("Test");
    expect(rates[0].rate).toBe(3);
  });

  test("窗口外的数据被忽略", () => {
    const tracker = new LogRateTracker(1000);
    tracker.record({ logger: "T", timestamp: 500 });

    jest.setSystemTime(2000);
    tracker.record({ logger: "T", timestamp: 1500 });
    tracker.record({ logger: "T", timestamp: 1600 });

    const rates = tracker.getRates();
    expect(rates[0].rate).toBe(2);
  });

  test("无记录的 Logger 不返回", () => {
    const tracker = new LogRateTracker();
    expect(tracker.getRates()).toEqual([]);
  });

  test("subscribe 自动连接 LogBus", () => {
    const tracker = new LogRateTracker();
    const bus = new LogBus();
    tracker.subscribe(bus);

    bus.emit("INFO", {
      level: "INFO",
      logger: "A",
      timestamp: Date.now(),
    });
    bus.emit("WARN", {
      level: "WARN",
      logger: "A",
      timestamp: Date.now(),
    });
    bus.emit("INFO", {
      level: "INFO",
      logger: "B",
      timestamp: Date.now(),
    });

    const rates = tracker.getRates();
    expect(rates).toHaveLength(2);
  });

  test("clear 清空", () => {
    const tracker = new LogRateTracker();
    tracker.record({ logger: "T", timestamp: Date.now() });
    tracker.clear();
    expect(tracker.getRates()).toEqual([]);
  });
});
