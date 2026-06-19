/**
 * @file LEVELS / resolveLevel 单元测试
 * @description 测试日志级别枚举和解析工具函数。
 * @module utils/log/tests/levels.test
 * @author Zhou Chenyu
 */

import { describe, test, expect } from "@jest/globals";
import { LEVELS, resolveLevel } from "../levels.js";

describe("LEVELS", () => {
  test("级别按升序排列", () => {
    expect(LEVELS.DEBUG).toBe(0);
    expect(LEVELS.INFO).toBe(1);
    expect(LEVELS.WARN).toBe(2);
    expect(LEVELS.ERROR).toBe(3);
    expect(LEVELS.SILENT).toBe(4);
  });
});

describe("resolveLevel()", () => {
  test("从字符串解析级别值", () => {
    expect(resolveLevel("DEBUG")).toBe(LEVELS.DEBUG);
    expect(resolveLevel("INFO")).toBe(LEVELS.INFO);
    expect(resolveLevel("WARN")).toBe(LEVELS.WARN);
    expect(resolveLevel("ERROR")).toBe(LEVELS.ERROR);
    expect(resolveLevel("SILENT")).toBe(LEVELS.SILENT);
  });

  test("忽略大小写", () => {
    expect(resolveLevel("debug")).toBe(LEVELS.DEBUG);
    expect(resolveLevel("Debug")).toBe(LEVELS.DEBUG);
  });

  test("未知字符串返回 fallback", () => {
    expect(resolveLevel("INVALID")).toBe(LEVELS.INFO);
    expect(resolveLevel("INVALID", LEVELS.SILENT)).toBe(LEVELS.SILENT);
  });
});
