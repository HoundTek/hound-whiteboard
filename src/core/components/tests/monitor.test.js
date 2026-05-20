import { Monitor } from "../monitor.js";
import { Vector } from "../../utils/math.js";
import {
  createDebuggerDevice,
  DEBUGGER_DEVICE_SIGNAL_TYPES,
} from "../../devices/debugger-device.js";

describe("Monitor", () => {
  function createMonitor(monitorId = "monitor") {
    const canvas = {
      width: 0,
      height: 0,
      id: "",
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600 };
      },
    };
    const board = {
      width: 800,
      height: 600,
      createPageLoader() {
        return {};
      },
    };

    return new Monitor(canvas, board, { width: 800, height: 600 }, monitorId);
  }

  test("mountDevice 应自动补上 monitorId 后挂载设备", () => {
    const monitor = createMonitor("alpha");
    const debuggerDevice = createDebuggerDevice();

    const mountedNodes = monitor.mountDevice("/debugger", debuggerDevice);
    const packets = monitor.devicesTree.dispatch({
      to: "/alpha/debugger",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/alpha/debugger",
      "/alpha/debugger/report",
    ]);
    expect(packets).toEqual([
      {
        to: "/alpha/debugger/report",
        signals: [
          {
            type: DEBUGGER_DEVICE_SIGNAL_TYPES.REPORT,
            context: {
              index: 0,
              receivedAt: "/alpha/debugger",
              originalTo: "/alpha/debugger",
              signalCount: 1,
            },
          },
        ],
      },
    ]);
  });

  test("mountDevice 应规整不带前导斜杠的相对路径", () => {
    const monitor = createMonitor("beta");
    const debuggerDevice = createDebuggerDevice();

    const mountedNodes = monitor.mountDevice("debugger", debuggerDevice);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/beta/debugger",
      "/beta/debugger/report",
    ]);
  });

  test("screenToPage 应按二维页坐标映射命中对应页", () => {
    const monitor = createMonitor("gamma");

    expect(monitor.screenToWorld(new Vector(400, 300))).toEqual(
      new Vector(400, 300),
    );

    expect(monitor.worldToPage(new Vector(400, 300))).toEqual({
      pageId: 1,
      x: 400,
      y: 300,
    });

    expect(monitor.screenToPage(new Vector(400, 300))).toEqual({
      pageId: 1,
      x: 400,
      y: 300,
    });

    expect(monitor.screenToPage(new Vector(1000, 300))).toEqual({
      pageId: 2,
      x: 200,
      y: 300,
    });

    expect(monitor.screenToPage(new Vector(1200, 750))).toEqual({
      pageId: 3,
      x: 400,
      y: 150,
    });

    expect(monitor.screenToPage(new Vector(-200, 150))).toEqual({
      pageId: 6,
      x: 600,
      y: 150,
    });

    monitor.zoom = 2;
    monitor.origin = new Vector(100, 50);

    expect(monitor.screenToPage(new Vector(400, 250))).toEqual({
      pageId: 1,
      x: 300,
      y: 175,
    });
  });
});
