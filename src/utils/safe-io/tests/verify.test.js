import { createToken } from "../capability/token.js";
import { clear, register } from "../auth/registry.js";
import { verify } from "../ipc/verify.js";

describe("safe-io IPC token 验证", () => {
  beforeEach(() => {
    clear();
  });

  afterEach(() => {
    clear();
  });

  test("verify 可以验证签名并返回 capability context", () => {
    const handle = { path: "/tmp/note.txt" };
    const token = createToken({
      path: "/tmp/note.txt",
      permissions: { read: true, write: true },
    });

    register(token, handle);

    const context = verify(token);

    expect(context).toEqual({
      handle,
      permissions: token.permissions,
      id: token.id,
      root: token.root,
    });
  });

  test("verify 会拒绝缺失结构、篡改签名和不存在的 capability", () => {
    const token = createToken({
      path: "/tmp/ghost.txt",
      permissions: { read: true },
    });

    expect(() => verify(null)).toThrow("missing token");
    expect(() => verify({ id: "x" })).toThrow("invalid token structure");
    expect(() => verify({ ...token, signature: `${token.signature}bad` })).toThrow("invalid signature");
    expect(() => verify(token)).toThrow("capability revoked or not found");
  });

  test("verify 会拦截重放 token", () => {
    const handle = { path: "/tmp/replay.txt" };
    const token = createToken({
      path: "/tmp/replay.txt",
      permissions: { read: true },
    });

    register(token, handle);

    expect(verify(token).handle).toBe(handle);
    expect(() => verify(token)).toThrow("replay attack detected or expired token");
  });
});