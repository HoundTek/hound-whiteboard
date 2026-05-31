import { DevicesDAG, createSubDAG } from "../devices-dag.js";
import {
  createKeyboardDevice,
  KEYBOARD_DEVICE_SIGNAL_TYPES,
} from "../keyboard-device.js";
import { CollectingTool } from "../../test-support/mock-tools.js";

function toPlainPackets(packets) {
  return packets.map((packet) => ({
    to: packet.to,
    signals: packet.signals,
  }));
}

describe("keyboard-device", () => {
  test("按键按下应更新状态，并路由到 event、keydown 与按键专属节点", () => {
    const ddag = new DevicesDAG();
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
                  to: "tool",
                  signals: triggerSignals,
                };
          },
        },
      },
    });
    const tool = new CollectingTool();

    const mountedNodes = ddag.mountSubDAG("/monitor", keyboardDevice);
    ddag.mountTool("/monitor/keyboard/code/Space/tool", tool);

    expect(mountedNodes.map((node) => ddag.getNodePath(node))).toEqual([
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

    const result = ddag.dispatch({
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

    expect(toPlainPackets(result.packets)).toEqual([
      {
        to: "",
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
        to: "",
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
        to: "tool",
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
        path: "/monitor/keyboard/code/Space/tool",
      }),
    });
  });

  test("重复按键应路由到 repeat，并保留当前激活键", () => {
    const ddag = new DevicesDAG();
    const keyboardDevice = createKeyboardDevice();

    ddag.mountSubDAG("/monitor", keyboardDevice);

    ddag.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyA", key: "a", repeat: false },
        },
      ],
    });

    const result = ddag.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyA", key: "a", repeat: true },
        },
      ],
    });

    expect(toPlainPackets(result.packets)).toEqual([
      {
        to: "",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyA", key: "a", repeat: true },
          },
        ],
      },
      {
        to: "",
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
    const ddag = new DevicesDAG();
    const keyboardDevice = createKeyboardDevice();

    ddag.mountSubDAG("/monitor", keyboardDevice);

    ddag.dispatch({
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

    const keyupPackets = ddag.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keyup",
          context: { code: "KeyW", key: "w", repeat: false },
        },
      ],
    });

    expect(
      toPlainPackets(keyupPackets.packets)
        .map((packet) => packet.signals[0].type)
        .sort(),
    ).toEqual(["keyup", "keyup"]);

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

    ddag.dispatch({
      to: "/monitor/keyboard",
      signals: [{ type: "cancel", context: {} }],
    });

    expect(keyboardDevice.getState().activeKeys).toEqual([]);
  });

  test("可在按键节点把信号改写为 position 并汇流到公共工具节点", () => {
    const ddag = new DevicesDAG();
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
            return signals.length === 0 ? [] : { to: "tool", signals };
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
            return signals.length === 0 ? [] : { to: "tool", signals };
          },
        },
      },
    });

    const tool = new CollectingTool();

    const mountedNodes = ddag.mountSubDAG("/monitor", keyboardDevice);
    ddag.mountTool("/monitor/keyboard/code/KeyW/tool", tool);
    ddag.mountTool("/monitor/keyboard/code/KeyD/tool", tool);

    expect(mountedNodes.map((node) => ddag.getNodePath(node))).toEqual([
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

    const result = ddag.dispatch({
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

    expect(toPlainPackets(result.packets)).toEqual([
      {
        to: "",
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
        to: "",
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
      to: "tool",
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
      to: "tool",
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
