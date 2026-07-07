/**
 * @file Logger 单元测试
 * @description 测试 Logger 的基本发射、级别过滤、子 Logger 继承、兜底 fallback、源头节流和自适应采样。
 * @author Zhou Chenyu
 */

import { jest, describe, test, expect } from "@jest/globals";
import { Logger } from "../logger.js";
import { LogBus } from "../log-bus.js";
import { LEVELS } from "../levels.js";

describe("Logger", () => {
  let bus;
  let entries;

  beforeEach(() => {
    entries = [];
    bus = new LogBus();
    bus.onAny((entry) => entries.push(entry));
  });

  // ── 基本发射 ──

  test("info 发射到 LogBus", () => {
    const log = new Logger("Test", LEVELS.INFO, bus);
    log.info("hello");
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("INFO");
    expect(entries[0].logger).toBe("Test");
    expect(entries[0].args).toEqual(["hello"]);
  });

  test("debug、warn、error 分别发射", () => {
    const log = new Logger("T", LEVELS.DEBUG, bus);
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.level)).toEqual([
      "DEBUG",
      "INFO",
      "WARN",
      "ERROR",
    ]);
  });

  // ── 级别过滤 ──

  test("级别低于阈值的日志被过滤", () => {
    const log = new Logger("T", LEVELS.WARN, bus);
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.level)).toEqual(["WARN", "ERROR"]);
  });

  test("SILENT 关闭所有", () => {
    const log = new Logger("T", LEVELS.SILENT, bus);
    log.info("i");
    log.error("e");
    expect(entries).toHaveLength(0);
  });

  test("setLevel 支持字符串", () => {
    const log = new Logger("T", LEVELS.SILENT, bus);
    log.setLevel("DEBUG");
    log.info("i");
    expect(entries).toHaveLength(1);
  });

  // ── 时间戳 ──

  test("日志包含 timestamp", () => {
    const log = new Logger("T", LEVELS.INFO, bus);
    const before = Date.now();
    log.info("msg");
    const after = Date.now();
    expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(entries[0].timestamp).toBeLessThanOrEqual(after);
  });

  // ── 子 Logger ──

  test("child 继承命名空间", () => {
    const log = new Logger("App", LEVELS.INFO, bus);
    const sub = log.child("Sub");
    sub.info("hi");
    expect(entries[0].logger).toBe("App:Sub");
  });

  test("child 继承日志级别", () => {
    const log = new Logger("App", LEVELS.ERROR, bus);
    const sub = log.child("Sub");
    sub.info("should not appear");
    sub.error("should appear");
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("ERROR");
  });

  test("child 携带额外 meta", () => {
    const log = new Logger("App", LEVELS.INFO, bus);
    const sub = log.child("Sub", { chunkId: 5 });
    sub.info("msg");
    expect(entries[0].meta.chunkId).toBe(5);
  });

  // ── 兜底行为 ──

  test("无 LogBus 时 fallback 到 console", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    const log = new Logger("Fallback", LEVELS.INFO);
    log.info("test fallback");
    expect(spy).toHaveBeenCalledWith("[Fallback]", "test fallback");
    spy.mockRestore();
  });

  // ── 节流 ──

  test("throttledWarn 同 key 窗口内不重复", () => {
    const log = new Logger("T", LEVELS.WARN, bus);
    log.throttledWarn("k", "first");
    log.throttledWarn("k", "second");
    expect(entries).toHaveLength(1);
    expect(entries[0].args).toEqual(["first"]);
  });

  test("throttledError 节流条目带标记", () => {
    const log = new Logger("T", LEVELS.ERROR, bus);
    log.throttledError("k", "err");
    expect(entries[0].meta.throttled).toBe(true);
    expect(entries[0].meta.throttleKey).toBe("k");
  });

  test("throttledInfo 不同 key 各自独立", () => {
    const log = new Logger("T", LEVELS.INFO, bus);
    log.throttledInfo("a", "msg a");
    log.throttledInfo("b", "msg b");
    expect(entries).toHaveLength(2);
  });

  // ── 自适应采样 ──

  test("DEBUG 默认启用自适应采样", () => {
    const log = new Logger("T", LEVELS.DEBUG, bus);

    log.debug("first");
    expect(entries).toHaveLength(1);

    let passed = 1;
    for (let i = 0; i < 200; i++) {
      log.debug(`dense ${i}`);
    }
    expect(entries.length).toBeLessThan(202);
    expect(entries.length).toBeGreaterThan(0);
  });

  test("INFO 不启用自适应采样", () => {
    const log = new Logger("T", LEVELS.INFO, bus);
    for (let i = 0; i < 200; i++) {
      log.info(`msg ${i}`);
    }
    expect(entries).toHaveLength(200);
  });
});
