import { jest } from "@jest/globals";

const handleMock = jest.fn();

await jest.unstable_mockModule("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

const { registerHandlers, setWindowManager } = await import("../ipc/handlers.js");

describe("safe-io IPC handlers", () => {
  beforeEach(() => {
    handleMock.mockReset();
    delete global.SECURE_DIRS;
  });

  test("registerHandlers 会注册窗口与存储相关通道", () => {
    registerHandlers();

    const channels = handleMock.mock.calls.map(([channel]) => channel);

    expect(channels).toEqual([
      "window:create",
      "window:close",
      "storage:get-directories",
    ]);
  });

  test("注册后的 handler 会委托给 window manager 并读取安全目录", () => {
    const createWindow = jest.fn((config) => ({ id: `w-${config.name}` }));
    const close = jest.fn();
    const getWindow = jest.fn(() => ({ win: { close } }));

    setWindowManager({ createWindow, getWindow });
    global.SECURE_DIRS = {
      SAVE_DATA: "/safe/saves",
      PLUGINS: "/safe/plugins",
      RESOURCE_PACKS: "/safe/resources",
    };

    registerHandlers();

    const createHandler = handleMock.mock.calls.find(([channel]) => channel === "window:create")[1];
    const closeHandler = handleMock.mock.calls.find(([channel]) => channel === "window:close")[1];
    const storageHandler = handleMock.mock.calls.find(([channel]) => channel === "storage:get-directories")[1];

    expect(createHandler({}, { name: "main" })).toEqual({ id: "w-main" });
    expect(createWindow).toHaveBeenCalledWith({ name: "main" });

    expect(closeHandler({}, "window-1")).toBe(true);
    expect(getWindow).toHaveBeenCalledWith("window-1");
    expect(close).toHaveBeenCalled();

    expect(storageHandler()).toEqual({
      saves: "/safe/saves",
      plugins: "/safe/plugins",
      resources: "/safe/resources",
    });
  });
});