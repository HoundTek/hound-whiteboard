/**
 * @file createConsolePrinter 单元测试
 * @description 测试控制台输出器的级别映射、指定级别过滤和取消订阅功能。
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
import { createConsolePrinter } from "../console-printer.js";
import { LogBus } from "../log-bus.js";

describe("createConsolePrinter", () => {
  let spyLog, spyWarn, spyError;

  beforeEach(() => {
    spyLog = jest.spyOn(console, "log").mockImplementation(() => {});
    spyWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
    spyError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    spyLog.mockRestore();
    spyWarn.mockRestore();
    spyError.mockRestore();
  });

  test("输出到对应 console 方法", () => {
    const bus = new LogBus();
    createConsolePrinter(bus, { timestamps: false });

    bus.emit("INFO", { level: "INFO", logger: "Test", args: ["hello"] });
    bus.emit("WARN", { level: "WARN", logger: "Test", args: ["warn"] });
    bus.emit("ERROR", { level: "ERROR", logger: "Test", args: ["err"] });

    expect(spyLog).toHaveBeenCalled();
    expect(spyWarn).toHaveBeenCalled();
    expect(spyError).toHaveBeenCalled();
  });

  test("可订阅指定级别", () => {
    const bus = new LogBus();
    createConsolePrinter(bus, {
      timestamps: false,
      levels: ["ERROR"],
    });

    bus.emit("INFO", { level: "INFO", logger: "T", args: ["info"] });
    bus.emit("ERROR", { level: "ERROR", logger: "T", args: ["err"] });

    expect(spyLog).not.toHaveBeenCalled();
    expect(spyError).toHaveBeenCalled();
  });

  test("返回取消订阅函数", () => {
    const bus = new LogBus();
    const off = createConsolePrinter(bus, { timestamps: false });
    off();

    bus.emit("INFO", { level: "INFO", logger: "T", args: ["msg"] });
    expect(spyLog).not.toHaveBeenCalled();
  });
});
