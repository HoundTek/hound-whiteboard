import { jest } from "@jest/globals";

import { clear, gc, register, registryEvents, revoke, stats } from "../auth/registry.js";

describe("safe-io registry 事件与监听器管理", () => {
  let nowSpy;

  beforeEach(() => {
    clear();
  });

  afterEach(() => {
    if (nowSpy) {
      nowSpy.mockRestore();
      nowSpy = null;
    }
    clear();
  });

  test("register、revoke、gc 会按操作顺序发出事件", () => {
    const events = [];

    registryEvents.on("register", (id) => events.push(`register:${id}`));
    registryEvents.on("revoke", (id) => events.push(`revoke:${id}`));
    registryEvents.on("gc", (id) => events.push(`gc:${id}`));

    nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000);
    register({ id: "token-a", root: "/tmp/a", permissions: 1 }, { id: "handle-a" });
    nowSpy.mockReturnValueOnce(1500);
    register({ id: "token-b", root: "/tmp/b", permissions: 1 }, { id: "handle-b" });

    expect(revoke("token-a")).toBe(true);

    nowSpy.mockReturnValue(4000);
    gc(1000);

    expect(events).toEqual([
      "register:token-a",
      "register:token-b",
      "revoke:token-a",
      "gc:token-b",
    ]);
    expect(stats()).toEqual({ size: 0, revoked: 0 });
  });

  test("clear 会清空 listener 和 registry 内容", () => {
    const listener = jest.fn();

    registryEvents.on("register", listener);
    registryEvents.on("revoke", listener);

    register({ id: "token-clear", root: "/tmp/clear", permissions: 1 }, { id: "handle-clear" });

    expect(registryEvents.listenerCount("register")).toBe(1);
    expect(registryEvents.listenerCount("revoke")).toBe(1);
    expect(stats()).toEqual({ size: 1, revoked: 0 });

    clear();

    expect(registryEvents.listenerCount("register")).toBe(0);
    expect(registryEvents.listenerCount("revoke")).toBe(0);
    expect(stats()).toEqual({ size: 0, revoked: 0 });
  });
});