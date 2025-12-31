const { Queue } = require("./queue");

describe("Queue", () => {
  let queue = new Queue();

  beforeEach(() => {
    queue = new Queue();
  });
  describe("基础操作", () => {
    test("构造函数应正确初始化 elements, head 和 tail", () => {
      expect(queue.elements).toEqual(new Array(8));
      expect(queue.head).toBe(0);
      expect(queue.tail).toBe(0);
    });

    test("push 方法应正确添加元素", () => {
      queue.push(1);
      expect(queue.count()).toBe(1);
      expect(queue.peek()).toBe(1);
      queue.push(2);
      expect(queue.count()).toBe(2);
      expect(queue.peek()).toBe(1); // 队头不变
    });

    test("pop 方法应正确移除并返回队头元素", () => {
      queue.push(1);
      queue.push(2);
      expect(queue.pop()).toBe(1);
      expect(queue.count()).toBe(1);
      expect(queue.peek()).toBe(2);
      expect(queue.pop()).toBe(2);
      expect(queue.count()).toBe(0);
      expect(queue.empty()).toBe(true);
    });

    test("pop 方法在队列为空时应抛出 RangeError", () => {
      expect(() => queue.pop()).toThrow(RangeError);
      expect(() => queue.pop()).toThrow("Queue is empty");
    });

    test("count 方法应返回正确的元素数量", () => {
      expect(queue.count()).toBe(0);
      queue.push(1);
      expect(queue.count()).toBe(1);
      queue.push(2);
      expect(queue.count()).toBe(2);
      queue.pop();
      expect(queue.count()).toBe(1);
      queue.pop();
      expect(queue.count()).toBe(0);
    });

    test("empty 方法应正确判断队列是否为空", () => {
      expect(queue.empty()).toBe(true);
      queue.push(1);
      expect(queue.empty()).toBe(false);
      queue.pop();
      expect(queue.empty()).toBe(true);
    });

    test("peek 方法应返回队头元素而不移除它", () => {
      queue.push(1);
      queue.push(2);
      expect(queue.peek()).toBe(1);
      expect(queue.count()).toBe(2); // peek 不改变队列大小
      expect(queue.peek()).toBe(1);
    });

    test("peek 方法在队列为空时应抛出 RangeError", () => {
      expect(() => queue.peek()).toThrow(RangeError);
      expect(() => queue.peek()).toThrow("Queue is empty");
    });

    test("clear 方法应清空队列", () => {
      queue.push(1);
      queue.push(2);
      queue.push(3);
      expect(queue.count()).toBe(3);
      queue.clear();
      expect(queue.count()).toBe(0);
      expect(queue.empty()).toBe(true);
      expect(() => queue.peek()).toThrow(RangeError);
    });
  });

  // ========== 扩容测试 ==========
  describe("动态扩容", () => {
    test("应该在队列满时自动扩容", () => {
      // 初始容量为 8，可以存放 7 个元素（需要预留 1 个空位）
      for (let i = 0; i < 7; i++) {
        queue.push(i);
      }
      expect(queue.count()).toBe(7);
      expect(queue.capacity).toBe(8);

      // 再添加一个元素应该触发扩容
      queue.push(7);
      expect(queue.count()).toBe(8);
      expect(queue.capacity).toBe(16); // 扩容因子为 2
    });

    test("扩容后元素顺序应保持正确", () => {
      // 添加 10 个元素，会触发扩容
      for (let i = 0; i < 10; i++) {
        queue.push(i);
      }

      // 验证元素顺序
      for (let i = 0; i < 10; i++) {
        expect(queue.pop()).toBe(i);
      }
      expect(queue.empty()).toBe(true);
    });

    test("扩容后 peek 应该返回正确的队头元素", () => {
      for (let i = 0; i < 10; i++) {
        queue.push(i);
      }
      expect(queue.peek()).toBe(0);

      queue.pop();
      queue.pop();
      expect(queue.peek()).toBe(2);
    });

    test("应该支持多次扩容", () => {
      // 第一次扩容：8 -> 16
      for (let i = 0; i < 8; i++) {
        queue.push(i);
      }
      expect(queue.capacity).toBe(16);

      // 第二次扩容：16 -> 32
      for (let i = 8; i < 16; i++) {
        queue.push(i);
      }
      expect(queue.capacity).toBe(32);

      // 第三次扩容：32 -> 64
      for (let i = 16; i < 32; i++) {
        queue.push(i);
      }
      expect(queue.capacity).toBe(64);

      // 验证所有元素都在
      expect(queue.count()).toBe(32);
    });

    test("循环数组扩容时应正确处理 head 不在 0 位置的情况", () => {
      // 先添加一些元素
      for (let i = 0; i < 5; i++) {
        queue.push(i);
      }

      // 移除一些元素，使 head 移动
      queue.pop(); // 0
      queue.pop(); // 1
      expect(queue.head).toBe(2);
      expect(queue.count()).toBe(3);

      // 继续添加元素直到触发扩容
      for (let i = 5; i < 10; i++) {
        queue.push(i);
      }

      // 验证元素顺序正确（应该从 2 开始）
      expect(queue.count()).toBe(8);
      expect(queue.pop()).toBe(2);
      expect(queue.pop()).toBe(3);
      expect(queue.pop()).toBe(4);
      expect(queue.pop()).toBe(5);
    });

    test("大量数据扩容测试", () => {
      const testSize = 1000;

      // 添加大量数据
      for (let i = 0; i < testSize; i++) {
        queue.push(i);
      }

      expect(queue.count()).toBe(testSize);

      // 验证所有数据按顺序出队
      for (let i = 0; i < testSize; i++) {
        expect(queue.pop()).toBe(i);
      }

      expect(queue.empty()).toBe(true);
    });

    test("混合操作下的扩容稳定性", () => {
      // 模拟真实使用场景：添加、删除、扩容混合
      for (let i = 0; i < 5; i++) {
        queue.push(i);
      }

      queue.pop(); // 移除 0
      queue.pop(); // 移除 1

      for (let i = 5; i < 12; i++) {
        queue.push(i); // 触发扩容
      }

      expect(queue.count()).toBe(10); // 3 + 7 = 10

      // 验证元素正确性
      expect(queue.peek()).toBe(2);

      // 继续混合操作
      for (let i = 0; i < 5; i++) {
        queue.pop();
      }

      expect(queue.count()).toBe(5);

      for (let i = 12; i < 20; i++) {
        queue.push(i);
      }

      expect(queue.count()).toBe(13);

      // 验证队头元素
      expect(queue.peek()).toBe(7);
    });

    test("扩容后 clear 应该重置容量", () => {
      // 触发扩容
      for (let i = 0; i < 20; i++) {
        queue.push(i);
      }
      expect(queue.capacity).toBeGreaterThan(8);

      // 清空队列
      queue.clear();
      expect(queue.capacity).toBe(8); // 应该重置为初始容量
      expect(queue.count()).toBe(0);
      expect(queue.empty()).toBe(true);
    });

    test("扩容不应影响内存清理", () => {
      // 添加对象引用
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };

      queue.push(obj1);
      queue.push(obj2);

      for (let i = 0; i < 10; i++) {
        queue.push({ id: i + 3 });
      }

      // 触发扩容并移除元素
      const removed1 = queue.pop();
      const removed2 = queue.pop();

      expect(removed1).toBe(obj1);
      expect(removed2).toBe(obj2);

      // 验证已移除位置被清理（设为 undefined）
      expect(queue.elements[0]).toBeUndefined();
      expect(queue.elements[1]).toBeUndefined();
    });
  });

  // ========== 边界情况测试 ==========
  describe("边界情况", () => {
    test("单个元素的入队出队", () => {
      queue.push(42);
      expect(queue.count()).toBe(1);
      expect(queue.pop()).toBe(42);
      expect(queue.empty()).toBe(true);
    });

    test("反复填满和清空", () => {
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 7; i++) {
          queue.push(i);
        }
        expect(queue.count()).toBe(7);

        for (let i = 0; i < 7; i++) {
          expect(queue.pop()).toBe(i);
        }
        expect(queue.empty()).toBe(true);
      }
    });

    test("应该正确处理 undefined 和 null 值", () => {
      queue.push(undefined);
      queue.push(null);
      queue.push(0);
      queue.push("");
      queue.push(false);

      expect(queue.pop()).toBeUndefined();
      expect(queue.pop()).toBeNull();
      expect(queue.pop()).toBe(0);
      expect(queue.pop()).toBe("");
      expect(queue.pop()).toBe(false);
      expect(queue.empty()).toBe(true);
    });

    test("应该正确处理各种数据类型", () => {
      const testData = [
        123,
        "string",
        { obj: "test" },
        [1, 2, 3],
        true,
        null,
        undefined,
        Symbol("test"),
        new Date(),
        /regex/,
      ];

      testData.forEach((data) => queue.push(data));
      expect(queue.count()).toBe(testData.length);

      testData.forEach((data) => {
        const popped = queue.pop();
        if (typeof data === "symbol") {
          expect(typeof popped).toBe("symbol");
        } else {
          expect(popped).toBe(data);
        }
      });
    });
  });
});
