import { DevicesTree } from "../devices-tree.js";
import { createKeyboardDevice } from "../keyboard-device.js";

describe("keyboard-device", () => {
  test("按键按下应更新状态，并路由到 event、keydown 与按键专属节点", () => {
    const tree = new DevicesTree();
    const keyboardDevice = createKeyboardDevice({
      keyProcessors: {
        Space: (packet, context) => ({
          to: context.path,
          signals: [
            {
              type: "space-handled",
              context: { from: context.path },
            },
          ],
        }),
      },
    });

    const mountedNodes = tree.mountDevice("/monitor/keyboard", keyboardDevice);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/monitor/keyboard",
      "/monitor/keyboard/event",
      "/monitor/keyboard/keydown",
      "/monitor/keyboard/keyup",
      "/monitor/keyboard/repeat",
      "/monitor/keyboard/cancel",
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
      {
        to: "/monitor/keyboard/code/Space",
        signals: [
          {
            type: "space-handled",
            context: { from: "/monitor/keyboard/code/Space" },
          },
        ],
      },
    ]);
  });

  test("重复按键应路由到 repeat，并保留当前激活键", () => {
    const tree = new DevicesTree();
    const keyboardDevice = createKeyboardDevice();

    tree.mountDevice("/monitor/keyboard", keyboardDevice);

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

    tree.mountDevice("/monitor/keyboard", keyboardDevice);

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
});