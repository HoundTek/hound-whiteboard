/**
 * @file LogBus 单元测试
 * @description 测试 LogBus 的级别订阅、通配符订阅、多级别订阅和取消订阅行为。
 * @author Zhou Chenyu
 */

import { describe, test, expect } from "@jest/globals";
import { EventBus } from "../../../core/engine/utils/event-bus.js";
import { LogBus, logBus } from "../log-bus.js";

describe("LogBus", () => {
  test("继承自 EventBus", () => {
    const bus = new LogBus();
    expect(bus).toBeInstanceOf(EventBus);
  });

  test("emit 通知级别特定订阅者", () => {
    const bus = new LogBus();
    const received = [];
    bus.on("INFO", (entry) => received.push(entry));

    bus.emit("INFO", { level: "INFO", msg: "hi" });
    bus.emit("WARN", { level: "WARN", msg: "ignore" });
    expect(received).toHaveLength(1);
    expect(received[0].msg).toBe("hi");
  });

  test("emit 通知通配符订阅者", () => {
    const bus = new LogBus();
    const received = [];
    bus.onAny((entry) => received.push(entry));

    bus.emit("DEBUG", { level: "DEBUG" });
    bus.emit("ERROR", { level: "ERROR" });
    expect(received).toHaveLength(2);
  });

  test("级别订阅者和通配符订阅者都收到", () => {
    const bus = new LogBus();
    const levelReceived = [];
    const anyReceived = [];

    bus.on("INFO", (e) => levelReceived.push(e));
    bus.onAny((e) => anyReceived.push(e));

    bus.emit("INFO", { level: "INFO" });
    expect(levelReceived).toHaveLength(1);
    expect(anyReceived).toHaveLength(1);
  });

  test("onLevels 订阅多个级别", () => {
    const bus = new LogBus();
    const received = [];
    const off = bus.onLevels(["WARN", "ERROR"], (e) => received.push(e));

    bus.emit("INFO", { level: "INFO" });
    bus.emit("WARN", { level: "WARN" });
    bus.emit("ERROR", { level: "ERROR" });
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.level)).toEqual(["WARN", "ERROR"]);

    off();
    bus.emit("ERROR", { level: "ERROR" });
    expect(received).toHaveLength(2);
  });

  test("取消订阅正常工作", () => {
    const bus = new LogBus();
    const received = [];
    const off = bus.on("INFO", (e) => received.push(e));
    off();
    bus.emit("INFO", { level: "INFO" });
    expect(received).toHaveLength(0);
  });

  test("global logBus 是单例", () => {
    expect(logBus).toBeInstanceOf(LogBus);
  });
});
