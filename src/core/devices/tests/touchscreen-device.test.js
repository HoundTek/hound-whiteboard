import {
  createTouchscreenDevice,
  TOUCHSCREEN_DEVICE_SIGNAL_TYPES,
} from "../touchscreen-device.js";
import { DevicesTree } from "../devices-tree.js";

describe("touchscreen-device", () => {
  test("应聚合同一包中的多个触点位置，并输出多指状态", () => {
    const tree = new DevicesTree();
    const touchscreenDevice = createTouchscreenDevice();

    const mountedNodes = tree.mountDevice(
      "/monitor/touchscreen",
      touchscreenDevice,
    );

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/monitor/touchscreen",
      "/monitor/touchscreen/contacts",
    ]);

    const packets = tree.dispatch({
      to: "/monitor/touchscreen",
      signals: [
        {
          type: "position",
          context: { touchId: "finger-1", value: { x: 10, y: 20 } },
        },
        {
          type: "position",
          context: { touchId: "finger-2", value: { x: 30, y: 40 } },
        },
      ],
    });

    expect(touchscreenDevice.getActiveTouches()).toEqual([
      {
        touchId: "finger-1",
        position: { x: 10, y: 20 },
      },
      {
        touchId: "finger-2",
        position: { x: 30, y: 40 },
      },
    ]);

    expect(packets).toEqual([
      {
        to: "/monitor/touchscreen/contacts",
        signals: [
          {
            type: TOUCHSCREEN_DEVICE_SIGNAL_TYPES.CONTACTS,
            context: {
              contacts: [
                {
                  touchId: "finger-1",
                  position: { x: 10, y: 20 },
                },
                {
                  touchId: "finger-2",
                  position: { x: 30, y: 40 },
                },
              ],
              changedTouchIds: ["finger-1", "finger-2"],
              activeTouchIds: ["finger-1", "finger-2"],
            },
          },
        ],
      },
    ]);
  });

  test("应在 end/cancel 后移除对应触点，并保留其余触点", () => {
    const tree = new DevicesTree();
    const touchscreenDevice = createTouchscreenDevice();

    tree.mountDevice("/monitor/touchscreen", touchscreenDevice);

    tree.dispatch({
      to: "/monitor/touchscreen",
      signals: [
        {
          type: "position",
          context: { touchId: "finger-1", value: { x: 10, y: 20 } },
        },
        {
          type: "position",
          context: { touchId: "finger-2", value: { x: 30, y: 40 } },
        },
      ],
    });

    const packets = tree.dispatch({
      to: "/monitor/touchscreen",
      signals: [
        { type: "end", context: { touchId: "finger-1" } },
        {
          type: "position",
          context: { touchId: "finger-2", value: { x: 31, y: 41 } },
        },
      ],
    });

    expect(touchscreenDevice.getActiveTouches()).toEqual([
      {
        touchId: "finger-2",
        position: { x: 31, y: 41 },
      },
    ]);

    expect(packets).toEqual([
      {
        to: "/monitor/touchscreen/contacts",
        signals: [
          {
            type: TOUCHSCREEN_DEVICE_SIGNAL_TYPES.CONTACTS,
            context: {
              contacts: [
                {
                  touchId: "finger-2",
                  position: { x: 31, y: 41 },
                },
              ],
              changedTouchIds: ["finger-1", "finger-2"],
              activeTouchIds: ["finger-2"],
            },
          },
        ],
      },
    ]);
  });

  test("clearTouches 应清空所有当前触点", () => {
    const touchscreenDevice = createTouchscreenDevice();
    const tree = new DevicesTree();

    tree.mountDevice("/monitor/touchscreen", touchscreenDevice);
    tree.dispatch({
      to: "/monitor/touchscreen",
      signals: [
        {
          type: "position",
          context: { touchId: "finger-1", value: { x: 10, y: 20 } },
        },
      ],
    });

    touchscreenDevice.clearTouches();

    expect(touchscreenDevice.getActiveTouches()).toEqual([]);
  });
});