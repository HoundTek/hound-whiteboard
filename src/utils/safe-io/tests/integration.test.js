import fs from "fs";
import os from "os";
import path from "path";

import { authorize, clearRoots, registerRoot } from "../auth/authorize.js";
import { enforcePermission } from "../auth/permission.js";
import { clear, get, register, revoke, stats } from "../auth/registry.js";
import { BaseDir, File } from "../core/safe-io-core.js";
import { verify } from "../ipc/verify.js";

describe("safe-io 跨层集成链路", () => {
  let rootDir;
  let filePath;

  const createBase = () => BaseDir([rootDir]);

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-integration-"));
    filePath = path.join(rootDir, "note.txt");
    fs.writeFileSync(filePath, "hello", "utf8");
    clear();
    clearRoots();
  });

  afterEach(() => {
    clear();
    clearRoots();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test("authorize、registry、verify、permission 可以串起只读访问链路", () => {
    registerRoot(rootDir);

    const result = authorize(createBase(), File("note", "txt"));
    expect(result.isSome()).toBe(true);

    const { handle, token } = result.unwrap();
    expect(register(token, handle)).toBe(true);
    expect(get(token.id)).toBe(handle);
    expect(stats()).toEqual({ size: 1, revoked: 0 });

    const context = verify(token);
    const allowedHandle = enforcePermission(context, "fs:read");

    expect(allowedHandle).toBe(handle);
    expect(allowedHandle.read()).toBe("hello");
    expect(() => enforcePermission(context, "fs:write")).toThrow("permission denied: fs:write");
  });

  test("带自定义权限的链路可以执行写入并通过 registry revoke 失效", () => {
    registerRoot(rootDir);

    const result = authorize(createBase(), File("note", "txt"), {
      permissions: { read: true, write: true, ls: true },
    });
    const { handle, token } = result.unwrap();

    register(token, handle);

    const context = verify(token);
    const writableHandle = enforcePermission(context, "fs:write");

    expect(writableHandle.write("updated")).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("updated");

    expect(revoke(token.id)).toBe(true);
    expect(get(token.id)).toBeNull();
    expect(stats()).toEqual({ size: 0, revoked: 1 });
  });
});