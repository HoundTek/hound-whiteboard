/**
 * @file SharedStateStore 测试
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { SharedStateStore } from "../shared-state-store.js";

describe("SharedStateStore", () => {
  test("set/get 基本读写", () => {
    const store = new SharedStateStore();

    expect(store.get("activeTool")).toBeUndefined();

    store.set("activeTool", "stroke");
    expect(store.get("activeTool")).toBe("stroke");

    store.set("activeTool", "circle");
    expect(store.get("activeTool")).toBe("circle");
  });

  test("Object.is 相同的值重复 set 应跳过通知", () => {
    const store = new SharedStateStore();
    const callback = jest.fn();
    store.subscribe("k", callback);

    store.set("k", 1);
    store.set("k", 1);
    store.set("k", 2);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, 1, "k");
    expect(callback).toHaveBeenNthCalledWith(2, 2, "k");
  });

  test("subscribe 返回的退订函数应停止后续通知", () => {
    const store = new SharedStateStore();
    const callback = jest.fn();
    const unsubscribe = store.subscribe("k", callback);

    store.set("k", 1);
    unsubscribe();
    store.set("k", 2);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("同一键的多个订阅者都应收到通知", () => {
    const store = new SharedStateStore();
    const a = jest.fn();
    const b = jest.fn();
    store.subscribe("k", a);
    store.subscribe("k", b);

    store.set("k", "v");

    expect(a).toHaveBeenCalledWith("v", "k");
    expect(b).toHaveBeenCalledWith("v", "k");
  });

  test("单个订阅者抛错不中断其余订阅者", () => {
    const store = new SharedStateStore();
    const after = jest.fn();
    store.subscribe("k", () => {
      throw new Error("boom");
    });
    store.subscribe("k", after);

    expect(() => store.set("k", 1)).not.toThrow();
    expect(after).toHaveBeenCalledWith(1, "k");
    // 值仍正常写入
    expect(store.get("k")).toBe(1);
  });

  test("订阅者应收到自己写入的回声", () => {
    const store = new SharedStateStore();
    const events = [];
    store.subscribe("k", (value) => {
      events.push(value);
      if (value === "a") {
        // 订阅者在回调内写入另一个值（同键 LWW），自身也会收到回声
        store.set("k", "b");
      }
    });

    store.set("k", "a");

    // 回调内 set("k", "b") 触发重入通知，最终值为 b
    expect(events).toEqual(["a", "b"]);
    expect(store.get("k")).toBe("b");
  });

  test("getSnapshot 返回浅拷贝，修改快照不影响内部", () => {
    const store = new SharedStateStore();
    store.set("a", 1);
    store.set("b", 2);

    const snapshot = store.getSnapshot();
    expect(snapshot).toEqual({ a: 1, b: 2 });

    snapshot.a = 99;
    snapshot.c = 3;

    expect(store.get("a")).toBe(1);
    expect(store.get("c")).toBeUndefined();
  });
});
