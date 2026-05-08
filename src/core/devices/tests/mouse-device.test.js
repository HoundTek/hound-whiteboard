import { DevicesTree } from "../devices-tree.js";
import { createMouseDevice } from "../mouse-device.js";

describe("mouse-device", () => {
  test("普通移动应路由到 pointer 节点", () => {
    const tree = new DevicesTree();
    const mouseDevice = createMouseDevice();

    const mountedNodes = tree.mountDevice("/monitor/mouse", mouseDevice);
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

    tree.mountDevice("/monitor/mouse", mouseDevice);

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

    tree.mountDevice("/monitor/mouse", mouseDevice);
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

    tree.mountDevice("/monitor/mouse", mouseDevice);
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
    const mouseDevice = createMouseDevice({
      pointerProcessor(packet, context) {
        return {
          to: context.path,
          signals: [{ type: "pointer-handled", context: { from: context.path } }],
        };
      },
      primaryProcessor(packet, context) {
        return {
          to: context.path,
          signals: [{ type: "primary-handled", context: { from: context.path } }],
        };
      },
      wheelProcessor(packet, context) {
        return {
          to: context.path,
          signals: [{ type: "wheel-handled", context: { from: context.path } }],
        };
      },
    });

    tree.mountDevice("/monitor/mouse", mouseDevice);

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
        to: "/monitor/mouse/pointer",
        signals: [
          {
            type: "pointer-handled",
            context: { from: "/monitor/mouse/pointer" },
          },
        ],
      },
      {
        to: "/monitor/mouse/wheel",
        signals: [
          {
            type: "wheel-handled",
            context: { from: "/monitor/mouse/wheel" },
          },
        ],
      },
      {
        to: "/monitor/mouse/primary",
        signals: [
          {
            type: "primary-handled",
            context: { from: "/monitor/mouse/primary" },
          },
        ],
      },
    ]);
  });
});