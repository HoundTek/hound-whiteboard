import { Permission, OperationPermissionMap, combinePermissions, enforcePermission, hasPermission } from "../auth/permission.js";

describe("safe-io 权限位系统", () => {
  test("hasPermission 可以判断单个与组合权限", () => {
    const permissions = combinePermissions(Permission.READ, Permission.WRITE, Permission.ZIP);

    expect(hasPermission(permissions, Permission.READ)).toBe(true);
    expect(hasPermission(permissions, Permission.WRITE)).toBe(true);
    expect(hasPermission(permissions, Permission.DELETE)).toBe(false);
    expect(hasPermission(permissions, combinePermissions(Permission.READ, Permission.WRITE))).toBe(true);
  });

  test("combinePermissions 会合并多个权限位", () => {
    expect(combinePermissions()).toBe(0);
    expect(combinePermissions(Permission.READ, Permission.DELETE)).toBe(Permission.READ | Permission.DELETE);
  });

  test("OperationPermissionMap 为关键 IPC 操作提供权限映射", () => {
    expect(OperationPermissionMap["fs:read"]).toBe(Permission.READ);
    expect(OperationPermissionMap["fs:write"]).toBe(Permission.WRITE);
    expect(OperationPermissionMap["fs:hide"]).toBe(Permission.HIDE);
  });

  test("enforcePermission 会在权限满足时返回 handle", () => {
    const handle = { id: "handle" };
    const ctx = {
      handle,
      permissions: combinePermissions(Permission.READ, Permission.WRITE),
    };

    expect(enforcePermission(ctx, "fs:read")).toBe(handle);
    expect(enforcePermission(ctx, "fs:write")).toBe(handle);
  });

  test("enforcePermission 会拒绝无效上下文、未知操作和缺失权限", () => {
    expect(() => enforcePermission(null, "fs:read")).toThrow("invalid capability context");
    expect(() => enforcePermission({ handle: {} , permissions: Permission.READ }, "fs:unknown")).toThrow("unknown operation: fs:unknown");
    expect(() => enforcePermission({ handle: {}, permissions: Permission.READ }, "fs:write")).toThrow("permission denied: fs:write");
  });
});