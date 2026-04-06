const { EventBus } = require("../event-bus");

describe("EventBus", () => {
  test("on 和 emit 应该按注册顺序触发监听器", () => {
    const bus = new EventBus();
    const result = [];

    bus.on("page", (payload) => {
      result.push(["first", payload.pageId]);
      return "first";
    });
    bus.on("page", (payload) => {
      result.push(["second", payload.pageId]);
      return "second";
    });

    const returned = bus.emit("page", { pageId: 3 });

    expect(result).toEqual([
      ["first", 3],
      ["second", 3],
    ]);
    expect(returned).toEqual(["first", "second"]);
  });

  test("off 应该移除监听器", () => {
    const bus = new EventBus();
    const handler = jest.fn();

    bus.on("page", handler);
    expect(bus.off("page", handler)).toBe(true);
    bus.emit("page", { pageId: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  test("once 应该只触发一次", () => {
    const bus = new EventBus();
    const handler = jest.fn();

    bus.once("page", handler);
    bus.emit("page", { pageId: 1 });
    bus.emit("page", { pageId: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ pageId: 1 });
  });

  test("clear 应该支持清空指定事件和全部事件", () => {
    const bus = new EventBus();
    const pageHandler = jest.fn();
    const boardHandler = jest.fn();

    bus.on("page", pageHandler);
    bus.on("board", boardHandler);
    bus.clear("page");
    bus.emit("page", {});
    bus.emit("board", {});

    expect(pageHandler).not.toHaveBeenCalled();
    expect(boardHandler).toHaveBeenCalledTimes(1);

    bus.clear();
    bus.emit("board", {});
    expect(boardHandler).toHaveBeenCalledTimes(1);
  });
});