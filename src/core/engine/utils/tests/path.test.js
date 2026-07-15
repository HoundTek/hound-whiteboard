import { joinPath, normalizePath, resolvePath } from "../path.js";

describe("path utils", () => {
  test("normalizePath 应保留前导斜杠作为绝对路径标记", () => {
    expect(normalizePath("/a/b/c")).toEqual(["/", "a", "b", "c"]);
  });

  test("normalizePath 应处理相对路径", () => {
    expect(normalizePath("a/b/c")).toEqual(["a", "b", "c"]);
  });

  test("normalizePath 应处理根路径", () => {
    expect(normalizePath("/")).toEqual(["/"]);
  });

  test("normalizePath 应处理空路径", () => {
    expect(normalizePath("")).toEqual([]);
  });

  test("normalizePath 应清理多余斜杠", () => {
    expect(normalizePath("/viewport//keyboard///tool")).toEqual([
      "/",
      "viewport",
      "keyboard",
      "tool",
    ]);
  });

  test("joinPath 应拼接为绝对路径当前导部分含 /", () => {
    expect(joinPath("/", "viewport", "keyboard", "tool")).toBe(
      "/viewport/keyboard/tool",
    );
    expect(joinPath("/", "mouse", "primary")).toBe("/mouse/primary");
    expect(joinPath("/")).toBe("/");
  });

  test("joinPath 应拼接为相对路径当前导部分不含 /", () => {
    expect(joinPath("a", "b", "c")).toBe("a/b/c");
  });

  test("joinPath 应处理空输入", () => {
    expect(joinPath()).toBe("");
  });

  test("joinPath 应接受片段数组作为参数", () => {
    expect(joinPath(["/", "a", "b"])).toBe("/a/b");
    expect(joinPath(["a", "b"])).toBe("a/b");
  });

  test("resolvePath 应支持相对路径", () => {
    expect(resolvePath("/viewport/keyboard/code/Space", "tool")).toBe(
      "/viewport/keyboard/code/Space/tool",
    );
    expect(resolvePath("/viewport/keyboard/code/Space", "../event")).toBe(
      "/viewport/keyboard/code/event",
    );
  });

  test("resolvePath 应支持绝对路径作为 target", () => {
    expect(resolvePath("/viewport", "/a/b")).toBe("/a/b");
  });

  test("resolvePath 应处理空 target", () => {
    expect(resolvePath("/a/b")).toBe("/a/b");
  });
});
