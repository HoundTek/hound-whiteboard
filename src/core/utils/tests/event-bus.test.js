import { jest } from "@jest/globals";
import { EventBus } from "../event-bus.js";

describe("EventBus", () => {
  test("on 和 emit 应该按注册顺序触发监听器", () => {
    const bus = new EventBus();
    const result = [];

    bus.on("chunk", (payload) => {
      result.push(["first", payload.chunkId]);
      return "first";
    });
    bus.on("chunk", (payload) => {
      result.push(["second", payload.chunkId]);
      return "second";
    });

    const returned = bus.emit("chunk", { chunkId: 3 });

    expect(result).toEqual([
      ["first", 3],
      ["second", 3],
    ]);
    expect(returned).toEqual(["first", "second"]);
  });

  test("off 应该移除监听器", () => {
    const bus = new EventBus();
    const handler = jest.fn();

    bus.on("chunk", handler);
    expect(bus.off("chunk", handler)).toBe(true);
    bus.emit("chunk", { chunkId: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  test("once 应该只触发一次", () => {
    const bus = new EventBus();
    const handler = jest.fn();

    bus.once("chunk", handler);
    bus.emit("chunk", { chunkId: 1 });
    bus.emit("chunk", { chunkId: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ chunkId: 1 });
  });

  test("clear 应该支持清空指定事件和全部事件", () => {
    const bus = new EventBus();
    const chunkHandler = jest.fn();
    const boardHandler = jest.fn();

    bus.on("chunk", chunkHandler);
    bus.on("board", boardHandler);
    bus.clear("chunk");
    bus.emit("chunk", {});
    bus.emit("board", {});

    expect(chunkHandler).not.toHaveBeenCalled();
    expect(boardHandler).toHaveBeenCalledTimes(1);

    bus.clear();
    bus.emit("board", {});
    expect(boardHandler).toHaveBeenCalledTimes(1);
  });
});