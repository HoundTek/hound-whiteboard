/**
 * @file RingBuffer 单元测试
 * @description 测试环形缓冲区的写入顺序、覆写、length 限制、按级别筛选和 subscribe 连接。
 * @module utils/log/tests/ring-buffer.test
 * @author Zhou Chenyu
 */

import { describe, test, expect } from "@jest/globals";
import { RingBuffer } from "../ring-buffer.js";
import { LogBus } from "../log-bus.js";

describe("RingBuffer", () => {
  test("写入后按顺序导出", () => {
    const ring = new RingBuffer(5);
    ring.push({ i: 1 });
    ring.push({ i: 2 });
    ring.push({ i: 3 });

    expect(ring.dump()).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }]);
  });

  test("超过 size 后覆盖旧条目", () => {
    const ring = new RingBuffer(3);
    ring.push({ i: 1 });
    ring.push({ i: 2 });
    ring.push({ i: 3 });
    ring.push({ i: 4 });

    const dump = ring.dump();
    expect(dump).toHaveLength(3);
    expect(dump).toEqual([{ i: 2 }, { i: 3 }, { i: 4 }]);
  });

  test("length 不超过 size", () => {
    const ring = new RingBuffer(5);
    expect(ring.length).toBe(0);
    for (let i = 0; i < 10; i++) ring.push({ i });
    expect(ring.length).toBe(5);
  });

  test("totalPushed 记录总写入数", () => {
    const ring = new RingBuffer(5);
    for (let i = 0; i < 7; i++) ring.push({ i });
    expect(ring.totalPushed).toBe(7);
    expect(ring.length).toBe(5);
  });

  test("clear 清空", () => {
    const ring = new RingBuffer(3);
    ring.push({ i: 1 });
    ring.clear();
    expect(ring.dump()).toEqual([]);
    expect(ring.length).toBe(0);
  });

  test("dump 按时间顺序（环形覆写后仍然正确）", () => {
    const ring = new RingBuffer(4);
    for (let i = 0; i < 6; i++) ring.push({ i });

    expect(ring.dump()).toEqual([{ i: 2 }, { i: 3 }, { i: 4 }, { i: 5 }]);
  });

  test("dumpByLevel 筛选级别", () => {
    const ring = new RingBuffer(10);
    ring.push({ level: "INFO" });
    ring.push({ level: "ERROR" });
    ring.push({ level: "WARN" });
    ring.push({ level: "INFO" });

    const errors = ring.dumpByLevel("ERROR");
    expect(errors).toHaveLength(1);

    const infos = ring.dumpByLevel("INFO");
    expect(infos).toHaveLength(2);
  });

  test("subscribe 自动连接 LogBus", () => {
    const ring = new RingBuffer(5);
    const logBus = new LogBus();
    ring.subscribe(logBus);

    logBus.emit("INFO", { level: "INFO", msg: "hi" });
    logBus.emit("ERROR", { level: "ERROR", msg: "err" });

    expect(ring.length).toBe(2);
  });

  test("subscribe 可指定级别", () => {
    const ring = new RingBuffer(5);
    const logBus = new LogBus();
    ring.subscribe(logBus, ["ERROR"]);

    logBus.emit("INFO", { level: "INFO" });
    logBus.emit("ERROR", { level: "ERROR" });

    expect(ring.length).toBe(1);
    expect(ring.dump()[0].level).toBe("ERROR");
  });
});
