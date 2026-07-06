import { joinPath, normalizePath, resolvePath, toAbsolutePath } from "../path.js";

describe("path utils", () => {
  test("normalizePath 应移除多余斜杠与空片段", () => {
    expect(normalizePath("/viewport//keyboard///tool")).toEqual([
      "viewport",
      "keyboard",
      "tool",
    ]);
  });

  test("joinPath 应统一拼接为绝对路径", () => {
    expect(joinPath("/viewport/", "/keyboard", "tool")).toBe(
      "/viewport/keyboard/tool",
    );
  });

  test("resolvePath 应支持相对路径", () => {
    expect(resolvePath("/viewport/keyboard/code/Space", "tool")).toBe(
      "/viewport/keyboard/code/Space/tool",
    );
    expect(resolvePath("/viewport/keyboard/code/Space", "../event")).toBe(
      "/viewport/keyboard/code/event",
    );
  });

  test("toAbsolutePath 应将空片段数组映射到根路径", () => {
    expect(toAbsolutePath([])).toBe("/");
  });
});