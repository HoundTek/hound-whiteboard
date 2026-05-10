import fs from "fs";
import os from "os";
import path from "path";

import { FileHandle, auditLog } from "../capability/handle.js";

describe("safe-io capability handle", () => {
  let rootDir;
  let filePath;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-io-handle-"));
    filePath = path.join(rootDir, "note.txt");
    fs.writeFileSync(filePath, "hello", "utf8");
    auditLog.length = 0;
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    auditLog.length = 0;
  });

  test("默认 handle 可以读取和检查存在", () => {
    const handle = FileHandle(filePath);

    expect(handle.read()).toBe("hello");
    expect(handle.exists()).toBe(true);
    expect(handle.permissions.read).toBe(true);
    expect(handle.permissions.write).toBe(false);
  });

  test("grantPermission 与 revokePermission 会改变后续行为", () => {
    const handle = FileHandle(filePath);

    expect(handle.write("updated")).toBe(false);
    expect(handle.grantPermission("write")).toBe(true);
    expect(handle.write("updated")).toBe(true);
    expect(handle.read()).toBe("updated");

    expect(handle.revokePermission("read")).toBe(true);
    expect(handle.read()).toBeNull();
  });

  test("updatePermissions 可以启用删除能力", () => {
    const handle = FileHandle(filePath);

    expect(handle.updatePermissions({ rm: true })).toBe(true);
    expect(handle.rm()).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test("revoke 之后访问会抛出已撤销错误", () => {
    const handle = FileHandle(filePath, { write: true });

    expect(handle.revoke()).toBe(true);
    expect(handle.isRevoked()).toBe(true);
    expect(() => handle.read()).toThrow("[safe-io] handle revoked");
    expect(() => handle.write("blocked")).toThrow("[safe-io] handle revoked");
  });

  test("handle 会记录实例审计历史和全局审计日志", () => {
    const handle = FileHandle(filePath, { write: true });

    handle.read();
    handle.write("updated");
    handle.exists();

    const history = handle.getAuditHistory();
    const globalLog = handle.getAuditLog();

    expect(history).toHaveLength(3);
    expect(history.map((entry) => entry.action)).toEqual(["read", "write", "exists"]);
    expect(globalLog.length).toBeGreaterThanOrEqual(3);
  });
});