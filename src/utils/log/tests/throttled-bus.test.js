/**
 * @file ThrottledBus 单元测试
 * @description 测试 ThrottledBus 的定时刷出、满额刷出、手动刷出、subscribe 连接和统计数据。
 * @module utils/log/tests/throttled-bus.test
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
import { ThrottledBus } from "../throttled-bus.js";
import { LogBus } from "../log-bus.js";

describe("ThrottledBus", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("写入后定时刷出", () => {
    const onFlush = jest.fn();
    const bus = new ThrottledBus({
      flushInterval: 200,
      maxBufferSize: 100,
      onFlush,
    });

    bus.write({ level: "INFO", msg: "hello" });
    expect(onFlush).not.toHaveBeenCalled();

    jest.advanceTimersByTime(250);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([{ level: "INFO", msg: "hello" }]);
  });

  test("满额立即刷出", () => {
    const onFlush = jest.fn();
    const bus = new ThrottledBus({
      flushInterval: 5000,
      maxBufferSize: 3,
      onFlush,
    });

    bus.write({ i: 1 });
    bus.write({ i: 2 });
    expect(onFlush).not.toHaveBeenCalled();

    bus.write({ i: 3 });
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([{ i: 1 }, { i: 2 }, { i: 3 }]);
  });

  test("满额刷出后重启定时器", () => {
    const onFlush = jest.fn();
    const bus = new ThrottledBus({
      flushInterval: 300,
      maxBufferSize: 2,
      onFlush,
    });

    bus.write({ i: 1 });
    bus.write({ i: 2 });
    expect(onFlush).toHaveBeenCalledTimes(1);

    bus.write({ i: 3 });
    jest.advanceTimersByTime(350);
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith([{ i: 3 }]);
  });

  test("空缓冲区不触发射", () => {
    const onFlush = jest.fn();
    const bus = new ThrottledBus({ flushInterval: 100, onFlush });

    jest.advanceTimersByTime(200);
    expect(onFlush).not.toHaveBeenCalled();
  });

  test("缓冲区满时新条目被丢弃", () => {
    const onFlush = jest.fn();
    const bus = new ThrottledBus({
      flushInterval: 5000,
      maxBufferSize: 2,
      onFlush,
    });

    bus.write({ i: 1 });
    bus.write({ i: 2 });
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(bus.stats.dropped).toBe(0);

    bus.write({ i: 3 });
    bus.write({ i: 4 });
    expect(onFlush).toHaveBeenCalledTimes(2);
    bus.write({ i: 5 });
    bus.write({ i: 6 });
    expect(onFlush).toHaveBeenCalledTimes(3);
  });

  test("flush() 手动触发刷出", () => {
    const onFlush = jest.fn();
    const bus = new ThrottledBus({
      flushInterval: 5000,
      maxBufferSize: 100,
      onFlush,
    });

    bus.write({ msg: "a" });
    bus.write({ msg: "b" });
    bus.flush();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([{ msg: "a" }, { msg: "b" }]);
  });

  test("shutdown 刷出剩余", () => {
    const onFlush = jest.fn();
    const bus = new ThrottledBus({
      flushInterval: 5000,
      maxBufferSize: 100,
      onFlush,
    });

    bus.write({ msg: "last" });
    bus.shutdown();
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  test("subscribe 自动连接 LogBus", () => {
    const onFlush = jest.fn();
    const bus = new ThrottledBus({
      flushInterval: 100,
      maxBufferSize: 100,
      onFlush,
    });
    const logBus = new LogBus();

    bus.subscribe(logBus, ["INFO"]);
    logBus.emit("INFO", { level: "INFO", msg: "auto" });

    jest.advanceTimersByTime(150);
    expect(onFlush).toHaveBeenCalledWith([{ level: "INFO", msg: "auto" }]);
  });

  test("stats 统计准确", () => {
    const onFlush = jest.fn();
    const bus = new ThrottledBus({
      flushInterval: 100,
      maxBufferSize: 5,
      onFlush,
    });

    bus.write({ i: 1 });
    bus.write({ i: 2 });
    expect(bus.stats.received).toBe(2);

    bus.flush();
    expect(bus.stats.flushed).toBe(2);
  });
});
