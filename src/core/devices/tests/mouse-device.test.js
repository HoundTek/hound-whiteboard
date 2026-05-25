import { DevicesTree } from "../devices-tree.js";
import { createMouseDevice } from "../mouse-device.js";
import { Tool } from "../../tools/tool.js";

describe("mouse-device", () => {
  test("普通移动应路由到 pointer 节点", () => {
    const tree = new DevicesTree();
    const mouseDevice = createMouseDevice();

    const mountedNodes = tree.mountDevice("/monitor", mouseDevice);
    const packets = tree.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 10, y: 20 }, buttons: 0, button: 0 },
        },
      ],
    });

    expect(mountedNodes.map((node) => node.path)).toEqual([
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
    expect(packets).toEqual([
      {
        to: "/monitor/mouse/pointer",
        signals: [
          {
            type: "position",
            context: { value: { x: 10, y: 20 }, buttons: 0, button: 0 },
          },
        ],
      },
    ]);
  });

  test("左键与右键可同时激活，并聚合路由到多个按钮节点", () => {
    const tree = new DevicesTree();
    const mouseDevice = createMouseDevice();

    tree.mountDevice("/monitor", mouseDevice);

    const packets = tree.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 10, y: 20 }, buttons: 3, button: 2 },
        },
      ],
    });

    expect(packets).toEqual([
      {
        to: "/monitor/mouse/pointer",
        signals: [
          {
            type: "position",
            context: { value: { x: 10, y: 20 }, buttons: 3, button: 2 },
          },
        ],
      },
      {
        to: "/monitor/mouse/primary",
        signals: [
          {
            type: "position",
            context: { value: { x: 10, y: 20 }, buttons: 3, button: 2 },
          },
        ],
      },
      {
        to: "/monitor/mouse/secondary",
        signals: [
          {
            type: "position",
            context: { value: { x: 10, y: 20 }, buttons: 3, button: 2 },
          },
        ],
      },
    ]);

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
    const tree = new DevicesTree();
    const mouseDevice = createMouseDevice();

    tree.mountDevice("/monitor", mouseDevice);
    tree.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 10, y: 20 }, buttons: 1, button: 0 },
        },
      ],
    });

    const packets = tree.dispatch({
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

    expect(packets).toEqual([
      {
        to: "/monitor/mouse/wheel",
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
      },
      {
        to: "/monitor/mouse/primary",
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
      },
    ]);

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
    const tree = new DevicesTree();
    const mouseDevice = createMouseDevice();

    tree.mountDevice("/monitor", mouseDevice);
    tree.dispatch({
      to: "/monitor/mouse",
      signals: [
        {
          type: "position",
          context: { value: { x: 15, y: 30 }, buttons: 3, button: 2 },
        },
      ],
    });

    const releasePackets = tree.dispatch({
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
    expect(releasePackets).toEqual([
      {
        to: "/monitor/mouse/pointer",
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
      },
      {
        to: "/monitor/mouse/primary",
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
      },
      {
        to: "/monitor/mouse/secondary",
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
      },
    ]);
  });

  test("可同时把同一包交给多个注入处理器", () => {
    const tree = new DevicesTree();
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
          to: context.eventContext.path,
          signals: [
            {
              type: this.type,
              context: { from: context.eventContext.path },
            },
          ],
        });
      }

      reset() {}
    }

    tree.mountDevice("/monitor", mouseDevice);
    tree.mountTool(
      "/monitor/mouse/pointer/tool",
      new MappingTool("pointer-handled"),
    );
    tree.mountTool(
      "/monitor/mouse/primary/tool",
      new MappingTool("primary-handled"),
    );
    tree.mountTool(
      "/monitor/mouse/wheel/tool",
      new MappingTool("wheel-handled"),
    );

    expect(
      tree.dispatch({
        to: "/monitor/mouse",
        signals: [
          {
            type: "position",
            context: { value: { x: 3, y: 4 }, buttons: 1, button: 0 },
          },
          {
            type: "wheel",
            context: { deltaX: 0, deltaY: 8, deltaZ: 0, buttons: 1, button: 0 },
          },
        ],
      }),
    ).toEqual([
      {
        to: "/monitor/mouse/pointer/tool",
        signals: [
          {
            type: "pointer-handled",
            context: { from: "/monitor/mouse/pointer/tool" },
          },
        ],
      },
      {
        to: "/monitor/mouse/wheel/tool",
        signals: [
          {
            type: "wheel-handled",
            context: { from: "/monitor/mouse/wheel/tool" },
          },
        ],
      },
      {
        to: "/monitor/mouse/primary/tool",
        signals: [
          {
            type: "primary-handled",
            context: { from: "/monitor/mouse/primary/tool" },
          },
        ],
      },
    ]);
  });
});
