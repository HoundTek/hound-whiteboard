import { Permission, combinePermissions } from "../auth/permission.js";
import { createToken, createTokenWithPreset } from "../capability/token.js";
import { verify } from "../crypto/sign.js";

describe("safe-io capability token", () => {
  test("createToken 会把对象权限规范化为 bitmask 并生成可验证签名", () => {
    const token = createToken({
      path: "/tmp/safe-io.txt",
      permissions: {
        read: true,
        write: true,
        rm: true,
        zip: true,
      },
    });

    expect(token.root).toBe("/tmp/safe-io.txt");
    expect(token.permissions).toBe(
      combinePermissions(Permission.READ, Permission.WRITE, Permission.DELETE, Permission.ZIP)
    );
    expect(typeof token.id).toBe("string");
    expect(typeof token.nonce).toBe("string");
    expect(verify(token.canonical(), token.signature)).toBe(true);
    expect(token.originalPermissions).toEqual({
      read: true,
      write: true,
      rm: true,
      zip: true,
    });
  });

  test("createToken 支持直接使用数值权限位", () => {
    const bitmask = combinePermissions(Permission.READ, Permission.HIDE);
    const token = createToken({
      path: "/tmp/secret.txt",
      permissions: bitmask,
    });

    expect(token.permissions).toBe(bitmask);
    expect(verify(token.canonical(), token.signature)).toBe(true);
  });

  test("createTokenWithPreset 会按预设生成权限位", () => {
    const readOnlyToken = createTokenWithPreset("/tmp/read.txt", "READ_ONLY");
    const readWriteToken = createTokenWithPreset("/tmp/write.txt", "READ_WRITE");
    const fullToken = createTokenWithPreset("/tmp/full.txt", "FULL");

    expect(readOnlyToken.permissions).toBe(combinePermissions(Permission.READ));
    expect(readWriteToken.permissions).toBe(combinePermissions(Permission.READ, Permission.WRITE, Permission.MKDIR));
    expect(fullToken.permissions).toBe(
      combinePermissions(
        Permission.READ,
        Permission.WRITE,
        Permission.DELETE,
        Permission.MKDIR,
        Permission.ZIP,
        Permission.UNZIP,
        Permission.HIDE
      )
    );
    expect(verify(fullToken.canonical(), fullToken.signature)).toBe(true);
  });
});