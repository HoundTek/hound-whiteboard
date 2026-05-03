import { jest } from "@jest/globals";

import { Device, DEVICE_EVENTS } from "../device.js";
import { Tool } from "../../tools/tool.js";

describe("Device", () => {
  test("应通过 toolChain 处理信号包，并通过 EventBus 发出收发事件", () => {
    class AppendSignalTool extends Tool {
      process(packet) {
        return {
          to: "/monitor/board",
          signals: packet.signals.concat([
            { type: "end", context: { committed: true } },
          ]),
        };
      }
    }

    class RenameTargetTool extends Tool {
      process(packet) {
        return {
          to: `${packet.to}/done`,
          signals: packet.signals,
        };
      }
    }

    const device = new Device({ name: "Stylus" });
    const receiveHandler = jest.fn();
    const emitHandler = jest.fn();

    device.on(DEVICE_EVENTS.RECEIVE_PACKET, receiveHandler);
    device.on(DEVICE_EVENTS.EMIT_PACKET, emitHandler);
    device.toolPush(new AppendSignalTool());
    device.toolPush(new RenameTargetTool());

    const packets = device.transmit(
      {
        to: "/monitor/input",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      },
      { source: "ui" },
    );

    expect(receiveHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        signalPacket: {
          to: "/monitor/input",
          signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
        },
        routeContext: { source: "ui" },
      }),
    );
    expect(packets).toEqual([
      {
        to: "/monitor/board/done",
        signals: [
          { type: "position", context: { value: { x: 1, y: 2 } } },
          { type: "end", context: { committed: true } },
        ],
      },
    ]);
    expect(emitHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        signalPackets: packets,
      }),
    );
  });

  test("toolPop 应返回当前工具链尾部工具", () => {
    class FirstTool extends Tool {
      process(packet) {
        return packet;
      }
    }

    class SecondTool extends Tool {
      process(packet) {
        return packet;
      }
    }

    const device = new Device();
    const firstTool = new FirstTool();
    const secondTool = new SecondTool();

    device.toolPush(firstTool);
    device.toolPush(secondTool);

    expect(device.toolPop()).toBe(firstTool);
    expect(device.currentTool).toBe(firstTool);
  });
});