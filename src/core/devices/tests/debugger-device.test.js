import {
  createDebuggerDevice,
  DEBUGGER_DEVICE_SIGNAL_TYPES,
} from "../debugger-device.js";
import { DevicesTree } from "../devices-tree.js";

describe("debugger-device", () => {
  test("应以设备子树形式挂载，并输出调试报告信号", () => {
    const tree = new DevicesTree();
    const records = [];
    const debuggerDevice = createDebuggerDevice({
      onRecord(entry) {
        records.push(entry);
      },
    });

    const mountedNodes = tree.mountSubTree("/monitor", debuggerDevice);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/monitor/debugger",
      "/monitor/debugger/report",
    ]);
    expect(tree.getNode("/monitor/debugger")?.getSemantics()).toEqual({
      prefix: true,
      prefixKind: "debug",
      routePolicy: "inspect",
    });

    const packets = tree.dispatch({
      to: "/monitor/debugger",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(records).toHaveLength(1);

    expect(records[0]).toEqual(
      expect.objectContaining({
        index: 0,
        receivedAt: "/monitor/debugger",
      }),
    );

    expect(debuggerDevice.getLastEntry()).toBe(records[0]);

    expect(packets).toEqual([
      {
        to: "/monitor/debugger/report",
        signals: [
          {
            type: DEBUGGER_DEVICE_SIGNAL_TYPES.REPORT,
            context: {
              index: 0,
              receivedAt: "/monitor/debugger",
              originalTo: "/monitor/debugger",
              signalCount: 1,
            },
          },
        ],
      },
    ]);
  });

  test("clearHistory 应清空调试记录", () => {
    const debuggerDevice = createDebuggerDevice();

    debuggerDevice.history.push({ index: 0 });
    debuggerDevice.clearHistory();

    expect(debuggerDevice.history).toEqual([]);
    expect(debuggerDevice.getLastEntry()).toBeNull();
  });
});
