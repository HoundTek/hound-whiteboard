/**
 * @file DragGestureProcessor 测试
 * @description 验证拖拽手势处理器的锚点、基准位置、初始位置回滚与位移同步语义。
 * @author Zhou Chenyu
 */

import { DragGestureProcessor } from "../drag-processor.js";
import { Vector } from "../../../../../../engine/utils/math.js";

/**
 * 构造模拟宿主 modifier（仅实现 processor 依赖的三个方法）
 * @returns {Object} 模拟 modifier
 */
function createMockModifier() {
  return {
    /**
     * 解析对象数字 id
     * @param {Object} obj - 对象条目
     * @returns {number|null} 数字 id
     */
    resolveObjectId(obj) {
      return typeof obj?.id === "number" ? obj.id : null;
    },
    /**
     * 解析对象当前位置
     * @param {Object} obj - 对象条目
     * @returns {Vector|null} 当前位置
     */
    resolveModifiedObjectPosition(obj) {
      return Vector.parse(obj?.position);
    },
    /**
     * 应用手势补丁（仅处理 position）
     * @param {Object} obj - 对象条目
     * @param {Object} patch - 手势补丁
     */
    applyGesturePatch(obj, patch) {
      if (patch.position) {
        obj.position = new Vector(patch.position.x, patch.position.y);
      }
    },
  };
}

describe("DragGestureProcessor", () => {
  test("begin 记录锚点与基准位置，同帧 update 位移为 0", () => {
    const processor = new DragGestureProcessor();
    const modifier = createMockModifier();
    const object = { id: 1, position: new Vector(10, 20) };
    const interaction = {
      objects: [object],
      position: new Vector(15, 23),
      context: {},
    };

    processor.begin(modifier, interaction);
    processor.update(modifier, interaction);

    expect(object.position).toEqual(new Vector(10, 20));
    expect(processor._anchor).toEqual({ x: 15, y: 23 });
    expect(processor._basePositions.get(1)).toEqual({ x: 10, y: 20 });
  });

  test("update 以锚点为基准计算位移并逐对象应用补丁", () => {
    const processor = new DragGestureProcessor();
    const modifier = createMockModifier();
    const objectA = { id: 1, position: new Vector(10, 20) };
    const objectB = { id: 2, position: new Vector(70, 80) };

    processor.begin(modifier, {
      objects: [objectA, objectB],
      position: new Vector(80, 50),
      context: {},
    });
    processor.update(modifier, {
      objects: [objectA, objectB],
      position: new Vector(90, 60),
      context: {},
    });

    // dx=10, dy=10
    expect(objectA.position).toEqual(new Vector(20, 30));
    expect(objectB.position).toEqual(new Vector(80, 90));
  });

  test("initialPositions 首次记录后永不覆盖，cancel 回滚到首轮初始位置", () => {
    const processor = new DragGestureProcessor();
    const modifier = createMockModifier();
    const object = { id: 1, position: new Vector(10, 20) };

    // 第一轮手势：(10, 20) → (14, 22)
    processor.begin(modifier, {
      objects: [object],
      position: new Vector(12, 20),
      context: {},
    });
    processor.update(modifier, {
      objects: [object],
      position: new Vector(16, 22),
      context: {},
    });
    expect(object.position).toEqual(new Vector(14, 22));
    processor.complete(modifier, { objects: [object], context: {} });

    // 第二轮手势：(14, 22) → (20, 26)，initial 不覆盖
    processor.begin(modifier, {
      objects: [object],
      position: new Vector(18, 24),
      context: {},
    });
    processor.update(modifier, {
      objects: [object],
      position: new Vector(24, 28),
      context: {},
    });
    expect(object.position).toEqual(new Vector(20, 26));
    expect(processor._initialPositions.get(1)).toEqual({ x: 10, y: 20 });

    processor.complete(modifier, { objects: [object], context: {} });
    processor.cancel(modifier, { objects: [object], context: {} });
    expect(object.position).toEqual(new Vector(10, 20));
  });

  test("complete 清空锚点与基准位置但保留初始位置，end 后 cancel 仍能回滚", () => {
    const processor = new DragGestureProcessor();
    const modifier = createMockModifier();
    const object = { id: 1, position: new Vector(10, 20) };

    processor.begin(modifier, {
      objects: [object],
      position: new Vector(12, 20),
      context: {},
    });
    processor.update(modifier, {
      objects: [object],
      position: new Vector(16, 22),
      context: {},
    });
    processor.complete(modifier, { objects: [object], context: {} });

    expect(processor._anchor).toBeNull();
    expect(processor._basePositions).toBeNull();
    expect(processor._initialPositions).not.toBeNull();

    processor.cancel(modifier, { objects: [object], context: {} });
    expect(object.position).toEqual(new Vector(10, 20));
  });

  test("cancel 回滚后清空全部手势状态", () => {
    const processor = new DragGestureProcessor();
    const modifier = createMockModifier();
    const object = { id: 1, position: new Vector(10, 20) };

    processor.begin(modifier, {
      objects: [object],
      position: new Vector(12, 20),
      context: {},
    });
    processor.update(modifier, {
      objects: [object],
      position: new Vector(16, 22),
      context: {},
    });
    processor.cancel(modifier, { objects: [object], context: {} });

    expect(object.position).toEqual(new Vector(10, 20));
    expect(processor._anchor).toBeNull();
    expect(processor._basePositions).toBeNull();
    expect(processor._initialPositions).toBeNull();
  });

  test("displace 在 initial 未记录时先补记，多次累加后 cancel 回退到首次位移前", () => {
    const processor = new DragGestureProcessor();
    const modifier = createMockModifier();
    const object = { id: 1, position: new Vector(10, 20) };

    processor.displace(modifier, {
      objects: [object],
      displacement: new Vector(3, 5),
      context: {},
    });
    expect(object.position).toEqual(new Vector(13, 25));
    expect(processor._initialPositions.get(1)).toEqual({ x: 10, y: 20 });

    processor.displace(modifier, {
      objects: [object],
      displacement: new Vector(2, 3),
      context: {},
    });
    expect(object.position).toEqual(new Vector(15, 28));
    // initial 仍为首次位移前的位置，不覆盖
    expect(processor._initialPositions.get(1)).toEqual({ x: 10, y: 20 });

    processor.cancel(modifier, { objects: [object], context: {} });
    expect(object.position).toEqual(new Vector(10, 20));
  });

  test("displace 平移基准位置而锚点不动，后续 position 不产生跳跃", () => {
    const processor = new DragGestureProcessor();
    const modifier = createMockModifier();
    const object = { id: 1, position: new Vector(10, 20) };

    // 手势激活：锚点 (12, 20)，对象移到 (14, 22)
    processor.begin(modifier, {
      objects: [object],
      position: new Vector(12, 20),
      context: {},
    });
    processor.update(modifier, {
      objects: [object],
      position: new Vector(16, 22),
      context: {},
    });
    expect(object.position).toEqual(new Vector(14, 22));

    // displacement (3, -1)：对象叠加到 (17, 21)，基准同步为 (13, 19)，锚点不动
    processor.displace(modifier, {
      objects: [object],
      displacement: new Vector(3, -1),
      context: {},
    });
    expect(object.position).toEqual(new Vector(17, 21));
    expect(processor._anchor).toEqual({ x: 12, y: 20 });
    expect(processor._basePositions.get(1)).toEqual({ x: 13, y: 19 });

    // 后续 position (22, 25)：dx=10, dy=5 → basePos (13, 19) + (10, 5) = (23, 24)
    processor.update(modifier, {
      objects: [object],
      position: new Vector(22, 25),
      context: {},
    });
    expect(object.position).toEqual(new Vector(23, 24));
  });

  test("reset 清空全部手势状态", () => {
    const processor = new DragGestureProcessor();
    const modifier = createMockModifier();
    const object = { id: 1, position: new Vector(10, 20) };

    processor.begin(modifier, {
      objects: [object],
      position: new Vector(12, 20),
      context: {},
    });
    processor.reset();

    expect(processor._anchor).toBeNull();
    expect(processor._basePositions).toBeNull();
    expect(processor._initialPositions).toBeNull();

    // reset 后新一轮手势从当前位置重新记录
    processor.begin(modifier, {
      objects: [object],
      position: new Vector(12, 20),
      context: {},
    });
    expect(processor._initialPositions.get(1)).toEqual({ x: 10, y: 20 });
  });
});
