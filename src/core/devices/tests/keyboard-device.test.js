import { DevicesTree, createSubTree } from "../devices-tree.js";
import {
  createKeyboardDevice,
  KEYBOARD_DEVICE_SIGNAL_TYPES,
} from "../keyboard-device.js";
import { CollectingTool } from "../../test-support/mock-tools.js";

describe("keyboard-device", () => {
  test("按键按下应更新状态，并路由到 event、keydown 与按键专属节点", () => {
    const tree = new DevicesTree();
    const keyboardDevice = createKeyboardDevice({
      nodeConfigs: {
        "/code/Space": {
          handler(packet) {
            const triggerSignals = packet.signals.filter(
              (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
            );

            return triggerSignals.length === 0
              ? []
              : {
                  to: "../../tools/create-circle/tool",
                  signals: triggerSignals,
                };
          },
        },
      },
    });
    const tool = new CollectingTool();

    const mountedNodes = tree.mountSubTree("/monitor", keyboardDevice);
    tree.mountTool("/monitor/keyboard/tools/create-circle/tool", tool);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/monitor/keyboard",
      "/monitor/keyboard/event",
      "/monitor/keyboard/keydown",
      "/monitor/keyboard/keyup",
      "/monitor/keyboard/repeat",
      "/monitor/keyboard/cancel",
      "/monitor/keyboard/tools",
      "/monitor/keyboard/code",
      "/monitor/keyboard/code/Space",
    ]);

    const packets = tree.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: {
            code: "Space",
            key: " ",
            repeat: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            metaKey: false,
          },
        },
      ],
    });

    expect(keyboardDevice.getState()).toEqual({
      activeKeys: [
        {
          code: "Space",
          key: " ",
          repeat: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        },
      ],
      lastEvent: {
        type: "keydown",
        code: "Space",
        key: " ",
        repeat: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      },
    });

    expect(packets).toEqual([
      {
        to: "/monitor/keyboard/event",
        signals: [
          {
            type: "keydown",
            context: {
              code: "Space",
              key: " ",
              repeat: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
              metaKey: false,
            },
          },
        ],
      },
      {
        to: "/monitor/keyboard/keydown",
        signals: [
          {
            type: "keydown",
            context: {
              code: "Space",
              key: " ",
              repeat: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
              metaKey: false,
            },
          },
        ],
      },
    ]);

    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0]).toEqual({
      signalPacket: {
        to: "/monitor/keyboard/tools/create-circle/tool",
        signals: [
          {
            type: KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
            context: {
              code: "Space",
              key: " ",
              repeat: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
              metaKey: false,
              sourceType: "keydown",
            },
          },
        ],
      },
      deviceContext: expect.objectContaining({
        path: "/monitor/keyboard/tools/create-circle/tool",
      }),
    });
  });

  test("重复按键应路由到 repeat，并保留当前激活键", () => {
    const tree = new DevicesTree();
    const keyboardDevice = createKeyboardDevice();

    tree.mountSubTree("/monitor", keyboardDevice);

    tree.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyA", key: "a", repeat: false },
        },
      ],
    });

    const packets = tree.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyA", key: "a", repeat: true },
        },
      ],
    });

    expect(packets).toEqual([
      {
        to: "/monitor/keyboard/event",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyA", key: "a", repeat: true },
          },
        ],
      },
      {
        to: "/monitor/keyboard/repeat",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyA", key: "a", repeat: true },
          },
        ],
      },
    ]);

    expect(keyboardDevice.getState().activeKeys).toEqual([
      {
        code: "KeyA",
        key: "a",
        repeat: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      },
    ]);
  });

  test("按键抬起与取消应清理状态", () => {
    const tree = new DevicesTree();
    const keyboardDevice = createKeyboardDevice();

    tree.mountSubTree("/monitor", keyboardDevice);

    tree.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyW", key: "w", repeat: false },
        },
        {
          type: "keydown",
          context: { code: "KeyA", key: "a", repeat: false },
        },
      ],
    });

    const keyupPackets = tree.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keyup",
          context: { code: "KeyW", key: "w", repeat: false },
        },
      ],
    });

    expect(keyupPackets).toEqual([
      {
        to: "/monitor/keyboard/event",
        signals: [
          {
            type: "keyup",
            context: { code: "KeyW", key: "w", repeat: false },
          },
        ],
      },
      {
        to: "/monitor/keyboard/keyup",
        signals: [
          {
            type: "keyup",
            context: { code: "KeyW", key: "w", repeat: false },
          },
        ],
      },
      {
        to: "/monitor/keyboard/code/KeyW",
        signals: [
          {
            type: KEYBOARD_DEVICE_SIGNAL_TYPES.RELEASE,
            context: {
              code: "KeyW",
              key: "w",
              repeat: false,
              sourceType: "keyup",
            },
          },
        ],
      },
    ]);

    expect(keyboardDevice.getState().activeKeys).toEqual([
      {
        code: "KeyA",
        key: "a",
        repeat: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      },
    ]);

    tree.dispatch({
      to: "/monitor/keyboard",
      signals: [{ type: "cancel", context: {} }],
    });

    expect(keyboardDevice.getState().activeKeys).toEqual([]);
  });

  test("可在按键节点把信号改写为 position 并汇流到公共工具节点", () => {
    const tree = new DevicesTree();
    const keyboardDevice = createKeyboardDevice({
      nodeConfigs: {
        "/code/KeyW": {
          handler(packet) {
            const signals = packet.signals
              .filter(
                (signal) =>
                  signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
              )
              .map((signal) => ({
                type: "position",
                context: {
                  value: { x: 0, y: -1 },
                  code: "KeyW",
                  sourceType: signal.type,
                },
              }));
            return signals.length === 0
              ? []
              : { to: "../../tools/move/tool", signals };
          },
        },
        "/code/KeyD": {
          handler(packet) {
            const signals = packet.signals
              .filter(
                (signal) =>
                  signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
              )
              .map((signal) => ({
                type: "position",
                context: {
                  value: { x: 1, y: 0 },
                  code: "KeyD",
                  sourceType: signal.type,
                },
              }));
            return signals.length === 0
              ? []
              : { to: "../../tools/move/tool", signals };
          },
        },
      },
    });

    const tool = new CollectingTool();

    const mountedNodes = tree.mountSubTree("/monitor", keyboardDevice);
    tree.mountTool("/monitor/keyboard/tools/move/tool", tool);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/monitor/keyboard",
      "/monitor/keyboard/event",
      "/monitor/keyboard/keydown",
      "/monitor/keyboard/keyup",
      "/monitor/keyboard/repeat",
      "/monitor/keyboard/cancel",
      "/monitor/keyboard/tools",
      "/monitor/keyboard/code",
      "/monitor/keyboard/code/KeyW",
      "/monitor/keyboard/code/KeyD",
    ]);

    const packets = tree.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyW", key: "w", repeat: false },
        },
        {
          type: "keydown",
          context: { code: "KeyD", key: "d", repeat: false },
        },
      ],
    });

    expect(packets).toEqual([
      {
        to: "/monitor/keyboard/event",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyW", key: "w", repeat: false },
          },
          {
            type: "keydown",
            context: { code: "KeyD", key: "d", repeat: false },
          },
        ],
      },
      {
        to: "/monitor/keyboard/keydown",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyW", key: "w", repeat: false },
          },
          {
            type: "keydown",
            context: { code: "KeyD", key: "d", repeat: false },
          },
        ],
      },
    ]);

    expect(tool.calls).toHaveLength(2);
    expect(tool.calls[0].signalPacket).toEqual({
      to: "/monitor/keyboard/tools/move/tool",
      signals: [
        {
          type: "position",
          context: {
            value: { x: 0, y: -1 },
            code: "KeyW",
            sourceType: "trigger",
          },
        },
      ],
    });
    expect(tool.calls[1].signalPacket).toEqual({
      to: "/monitor/keyboard/tools/move/tool",
      signals: [
        {
          type: "position",
          context: {
            value: { x: 1, y: 0 },
            code: "KeyD",
            sourceType: "trigger",
          },
        },
      ],
    });
  });
});
