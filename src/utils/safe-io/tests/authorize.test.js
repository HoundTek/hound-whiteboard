import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";

import { Permission, combinePermissions } from "../auth/permission.js";
import { authorize, clearRoots, getAuthorizedRoots, isPathAuthorized, registerRoot } from "../auth/authorize.js";
import { BaseDir, Dir, File } from "../core/safe-io-core.js";
import { verify } from "../crypto/sign.js";

describe("safe-io 授权流程", () => {
  let rootDir;
  let warnSpy;
  let errorSpy;

  const createBase = () => BaseDir([rootDir]);

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-auth-"));
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    clearRoots();
  });

  afterEach(() => {
    clearRoots();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test("registerRoot 会注册目录并暴露授权范围", () => {
    const result = registerRoot(rootDir);

    expect(result.isSome()).toBe(true);
    expect(getAuthorizedRoots()).toContain(rootDir);
    expect(isPathAuthorized(path.join(rootDir, "child.txt"))).toBe(true);
    expect(isPathAuthorized(path.join(os.tmpdir(), "outside.txt"))).toBe(false);
  });

  test("未注册根目录时 authorize 返回 None", () => {
    const result = authorize(createBase(), File("note", "txt"));

    expect(result.isNone()).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  test("authorize 可以为已存在文件生成 handle 和 token", () => {
    const filePath = path.join(rootDir, "note.txt");
    fs.writeFileSync(filePath, "hello", "utf8");
    registerRoot(rootDir);

    const result = authorize(createBase(), File("note", "txt"));

    expect(result.isSome()).toBe(true);

    const { handle, token } = result.unwrap();
    expect(handle.path).toBe(filePath);
    expect(handle.permissions.read).toBe(true);
    expect(handle.permissions.write).toBe(false);
    expect(token.root).toBe(filePath);
    expect(verify(token.canonical(), token.signature)).toBe(true);
  });

  test("authorize 会为预设权限生成对应的 handle 与 token", () => {
    const dirPath = path.join(rootDir, "docs");
    fs.mkdirSync(dirPath);
    registerRoot(rootDir);

    const result = authorize(createBase(), Dir("docs"), { preset: "READ_WRITE" });
    const { handle, token } = result.unwrap();

    expect(handle.permissions.write).toBe(true);
    expect(handle.permissions.zip).toBe(true);
    expect(token.permissions).toBe(combinePermissions(Permission.READ, Permission.WRITE, Permission.MKDIR));
  });

  test("authorize 会拒绝不存在的目标和非法名称", () => {
    registerRoot(rootDir);

    const missingResult = authorize(createBase(), File("missing", "txt"));
    const invalidNameResult = authorize(createBase(), File("../escape", "txt"));

    expect(missingResult.isNone()).toBe(true);
    expect(invalidNameResult.isNone()).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});