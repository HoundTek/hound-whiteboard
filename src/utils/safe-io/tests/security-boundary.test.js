import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";

import { authorize, clearRoots, registerRoot } from "../auth/authorize.js";
import { clear, gc, register, registryEvents, startGC, stats, stopGC } from "../auth/registry.js";
import { BaseDir, File } from "../core/safe-io-core.js";
import { sign } from "../crypto/sign.js";
import { verify } from "../ipc/verify.js";
import { FS } from "../runtime/fs.js";

describe("safe-io 安全边界与异常路径", () => {
  let rootDir;
  let outsideDir;
  let nowSpy;

  const createBase = () => BaseDir([rootDir]);

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-boundary-root-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-boundary-outside-"));
    clear();
    clearRoots();
  });

  afterEach(() => {
    stopGC();
    if (nowSpy) {
      nowSpy.mockRestore();
      nowSpy = null;
    }
    clear();
    clearRoots();
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  test("verify 会拒绝过期 token", () => {
    const token = {
      id: "expired-token",
      root: "/tmp/expired.txt",
      permissions: 1,
      timestamp: Date.now() - 1000 * 60 * 6,
      nonce: "expired-nonce",
    };

    const canonical = JSON.stringify(token, Object.keys(token).sort());
    const signedToken = {
      ...token,
      signature: sign(canonical),
    };

    expect(() => verify(signedToken)).toThrow("replay attack detected or expired token");
  });

  test("registry gc 会清理过期 capability 并发出 gc 事件", () => {
    const token = { id: "gc-token", root: "/tmp/gc.txt", permissions: 1 };
    const handle = { path: token.root };
    const gcListener = jest.fn();

    registryEvents.on("gc", gcListener);

    nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000);
    expect(register(token, handle)).toBe(true);
    nowSpy.mockReturnValue(3000);

    gc(500);

    expect(stats()).toEqual({ size: 0, revoked: 0 });
    expect(gcListener).toHaveBeenCalledWith("gc-token");
  });

  test("startGC 和 stopGC 会按定时器驱动并停止 registry 清理", () => {
    const token = { id: "timer-token", root: "/tmp/timer.txt", permissions: 1 };
    const handle = { path: token.root };
    const gcListener = jest.fn();

    jest.useFakeTimers();
    registryEvents.on("gc", gcListener);

    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    expect(register(token, handle)).toBe(true);

    startGC(100);

    jest.setSystemTime(new Date("2026-01-01T00:31:00.000Z"));
    jest.advanceTimersByTime(100);

    expect(gcListener).toHaveBeenCalledWith("timer-token");
    expect(stats()).toEqual({ size: 0, revoked: 0 });

    stopGC();
    gcListener.mockClear();
    jest.advanceTimersByTime(500);

    expect(gcListener).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test("FS 会拒绝路径穿越和超大内容写入", () => {
    const traversalPath = path.join(rootDir, "..", "escape.txt");
    const safePath = path.join(rootDir, "note.txt");
    const byteLengthSpy = jest.spyOn(Buffer, "byteLength").mockReturnValue(100 * 1024 * 1024 + 1);

    expect(FS.read(traversalPath, "utf8", rootDir)).toBeNull();
    expect(FS.write(traversalPath, "escape", "utf8", rootDir)).toBe(false);
    expect(FS.write(safePath, "too-large", "utf8", rootDir)).toBe(false);

    byteLengthSpy.mockRestore();
  });

  test("authorize 会拒绝指向授权范围外的符号链接", () => {
    const outsideFile = path.join(outsideDir, "secret.txt");
    const linkedFile = path.join(rootDir, "linked.txt");
    fs.writeFileSync(outsideFile, "outside", "utf8");
    fs.symlinkSync(outsideFile, linkedFile);
    registerRoot(rootDir);

    const result = authorize(createBase(), File("linked", "txt"));

    expect(result.isNone()).toBe(true);
  });

  test("FS.exists 和 FS.read 会拒绝授权边界外的符号链接目标", () => {
    const outsideFile = path.join(outsideDir, "private.txt");
    const linkedFile = path.join(rootDir, "linked.txt");
    fs.writeFileSync(outsideFile, "private", "utf8");
    fs.symlinkSync(outsideFile, linkedFile);

    expect(FS.exists(linkedFile, rootDir)).toBe(false);
    expect(FS.read(linkedFile, "utf8", rootDir)).toBeNull();
  });
});