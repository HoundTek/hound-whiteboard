import { DevicesDAG } from "../devices-dag.js";
import { createMouseDevice } from "../mouse-device.js";
import { Tool } from "../../tools/tool.js";

function createChannelReporter(channel) {
  return (packet) => ({
    stop: true,
    packets: [
      {
        to: "",
        signals: [
          {
            type: `${channel}-routed`,
            context: {
              channel,
              signals: packet.signals,
            },
          },
        ],
      },
    ],
  });
}

function createChannelReportingMouseDevice() {
  return createMouseDevice({
    pointerProcessor: createChannelReporter("pointer"),
    primaryProcessor: createChannelReporter("primary"),
    secondaryProcessor: createChannelReporter("secondary"),
    auxiliaryProcessor: createChannelReporter("auxiliary"),
    wheelProcessor: createChannelReporter("wheel"),
  });
}

function toPlainPackets(packets) {
  return packets.map((packet) => ({
    to: packet.to,
    signals: packet.signals,
  }));
}

describe("mouse-device", () => {
  test("普通移动应路由到 pointer 节点", () => {
    const dag = new DevicesDAG();
    const mouseDevice = createChannelReportingMouseDevice();

    const mountedNodes = dag.mountSubDAG("/monitor", mouseDevice);
    const result = dag.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 10, y: 20 }, buttons: 0, button: 0 },
        },
      ],
    });

    expect(mountedNodes.map((node) => dag.getNodePath(node))).toEqual([
      "/monitor/mouse",
      "/monitor/mouse/pointer",
      "/monitor/mouse/primary",
      "/monitor/mouse/secondary",
      "/monitor/mouse/auxiliary",
      "/monitor/mouse/wheel",
    ]);
    expect(mouseDevice.getState()).toEqual({
      activeButtons: {
        primary: false,
        secondary: false,
        auxiliary: false,
      },
      lastPosition: { x: 10, y: 20 },
      lastWheelDelta: null,
    });
    expect(toPlainPackets(result.packets)).toEqual([
      {
        to: "",
        signals: [
          {
            type: "pointer-routed",
            context: {
              channel: "pointer",
              signals: [
                {
                  type: "position",
                  context: { value: { x: 10, y: 20 }, buttons: 0, button: 0 },
                },
              ],
            },
          },
        ],
      },
    ]);
  });

  test("左键与右键可同时激活，并聚合路由到多个按钮节点", () => {
    const dag = new DevicesDAG();
    const mouseDevice = createChannelReportingMouseDevice();

    dag.mountSubDAG("/monitor", mouseDevice);

    const result = dag.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 10, y: 20 }, buttons: 3, button: 2 },
        },
      ],
    });

    expect(
      toPlainPackets(result.packets)
        .map((packet) => packet.signals[0].type)
        .sort(),
    ).toEqual(["pointer-routed", "primary-routed", "secondary-routed"]);

    expect(mouseDevice.getState()).toEqual({
      activeButtons: {
        primary: true,
        secondary: true,
        auxiliary: false,
      },
      lastPosition: { x: 10, y: 20 },
      lastWheelDelta: null,
    });
  });

  test("按住主键时滚轮事件应同时路由到 primary 和 wheel 节点", () => {
    const dag = new DevicesDAG();
    const mouseDevice = createChannelReportingMouseDevice();

    dag.mountSubDAG("/monitor", mouseDevice);
    dag.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 10, y: 20 }, buttons: 1, button: 0 },
        },
      ],
    });

    const result = dag.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "wheel",
          context: {
            deltaX: 0,
            deltaY: -120,
            deltaZ: 0,
            buttons: 1,
            button: 0,
          },
        },
      ],
    });

    expect(
      toPlainPackets(result.packets)
        .map((packet) => packet.signals[0].type)
        .sort(),
    ).toEqual(["primary-routed", "wheel-routed"]);

    expect(mouseDevice.getState()).toEqual({
      activeButtons: {
        primary: true,
        secondary: false,
        auxiliary: false,
      },
      lastPosition: { x: 10, y: 20 },
      lastWheelDelta: {
        deltaX: 0,
        deltaY: -120,
        deltaZ: 0,
      },
    });
  });

  test("主键抬起时应继续把结束包路由到 primary，同时保留其它激活键", () => {
    const dag = new DevicesDAG();
    const mouseDevice = createChannelReportingMouseDevice();

    dag.mountSubDAG("/monitor", mouseDevice);
    dag.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 15, y: 30 }, buttons: 3, button: 2 },
        },
      ],
    });

    const releaseResult = dag.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 18, y: 36 }, buttons: 2, button: 0 },
        },
        {
          type: "end",
          context: { button: 0, buttons: 2 },
        },
      ],
    });

    expect(mouseDevice.getState()).toEqual({
      activeButtons: {
        primary: false,
        secondary: true,
        auxiliary: false,
      },
      lastPosition: { x: 18, y: 36 },
      lastWheelDelta: null,
    });
    expect(
      toPlainPackets(releaseResult.packets)
        .map((packet) => packet.signals[0].type)
        .sort(),
    ).toEqual(["pointer-routed", "primary-routed", "secondary-routed"]);
  });

  test("可同时把同一包交给多个注入处理器", () => {
    const dag = new DevicesDAG();
    const mouseDevice = createMouseDevice();
    class MappingTool extends Tool {
      constructor(type) {
        super();
        this.type = type;
      }

      process(signalPacket, deviceContext) {
        this.lastCall = { signalPacket, deviceContext };
      }

      createProcessor() {
        return (packet, context) => ({
          to: "",
          signals: [
            {
              type: this.type,
              context: { from: context.path },
            },
          ],
        });
      }

      reset() {}
    }

    dag.mountSubDAG("/monitor", mouseDevice);
    dag.mountWorkflow(
      "/monitor/workflows/pointer-handled",
      new MappingTool("pointer-handled"),
    );
    dag.addEdge("/monitor/mouse/pointer", "tool", "/monitor/workflows/pointer-handled");
    dag.mountWorkflow(
      "/monitor/workflows/primary-handled",
      new MappingTool("primary-handled"),
    );
    dag.addEdge("/monitor/mouse/primary", "tool", "/monitor/workflows/primary-handled");
    dag.mountWorkflow(
      "/monitor/workflows/wheel-handled",
      new MappingTool("wheel-handled"),
    );
    dag.addEdge("/monitor/mouse/wheel", "tool", "/monitor/workflows/wheel-handled");

    expect(
      toPlainPackets(
        dag.dispatch({
          to: "/monitor/mouse",
          signals: [
            {
              type: "position",
              context: { value: { x: 3, y: 4 }, buttons: 1, button: 0 },
            },
            {
              type: "wheel",
              context: {
                deltaX: 0,
                deltaY: 8,
                deltaZ: 0,
                buttons: 1,
                button: 0,
              },
            },
          ],
        }).packets,
      )
        .map((packet) => packet.signals[0].type)
        .sort(),
    ).toEqual(["pointer-handled", "primary-handled", "wheel-handled"]);
  });
});
