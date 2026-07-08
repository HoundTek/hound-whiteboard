import { Queue } from "../queue.js";

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

  describe("动态扩容", () => {
    test("应该在队列满时自动扩容", () => {
      // 初始容量为 32，可以存放 31 个元素（需要预留 1 个空位）
      for (let i = 0; i < 31; i++) {
        queue.push(i);
      }
      expect(queue.count()).toBe(31);
      expect(queue.capacity).toBe(32);

      // 再添加一个元素应该触发扩容
      queue.push(31);
      expect(queue.count()).toBe(32);
      expect(queue.capacity).toBe(64); // 扩容因子为 2
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
      // 第一次扩容：32 -> 64
      for (let i = 0; i < 32; i++) {
        queue.push(i);
      }
      expect(queue.capacity).toBe(64);

      // 第二次扩容：64 -> 128
      for (let i = 32; i < 64; i++) {
        queue.push(i);
      }
      expect(queue.capacity).toBe(128);

      // 第三次扩容：128 -> 256
      for (let i = 64; i < 128; i++) {
        queue.push(i);
      }
      expect(queue.capacity).toBe(256);

      // 验证所有元素都在
      expect(queue.count()).toBe(128);
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

    test("扩容后 clear 应该重置容量", () => {
      // 触发扩容
      for (let i = 0; i < 40; i++) {
        queue.push(i);
      }
      expect(queue.capacity).toBeGreaterThan(32);

      // 清空队列
      queue.clear();
      expect(queue.capacity).toBe(32); // 应该重置为初始容量
      expect(queue.count()).toBe(0);
      expect(queue.empty()).toBe(true);
    });
  });

  describe("filter / map", () => {
    test("filter 应返回匹配的元素数组", () => {
      for (let i = 0; i < 10; i++) queue.push(i);
      const evens = queue.filter((n) => n % 2 === 0);
      expect(evens).toEqual([0, 2, 4, 6, 8]);
    });

    test("filter 无匹配时返回空数组", () => {
      queue.push(1);
      queue.push(3);
      const result = queue.filter((n) => n > 10);
      expect(result).toEqual([]);
    });

    test("filter 全部匹配时返回所有元素", () => {
      for (let i = 0; i < 5; i++) queue.push(i);
      const result = queue.filter((n) => n >= 0);
      expect(result).toEqual([0, 1, 2, 3, 4]);
    });

    test("filter 不应修改原队列", () => {
      for (let i = 0; i < 5; i++) queue.push(i);
      queue.filter((n) => n % 2 === 0);
      expect(queue.count()).toBe(5);
      expect(queue.toArray()).toEqual([0, 1, 2, 3, 4]);
    });

    test("空队列 filter 返回空数组", () => {
      expect(queue.filter((n) => true)).toEqual([]);
    });

    test("map 应返回变换后的数组", () => {
      for (let i = 0; i < 5; i++) queue.push(i);
      const doubled = queue.map((n) => n * 2);
      expect(doubled).toEqual([0, 2, 4, 6, 8]);
    });

    test("map 应保持元素顺序", () => {
      queue.push("a");
      queue.push("b");
      queue.push("c");
      const result = queue.map((s) => s.toUpperCase());
      expect(result).toEqual(["A", "B", "C"]);
    });

    test("map 不应修改原队列", () => {
      for (let i = 0; i < 5; i++) queue.push(i);
      queue.map((n) => n * 2);
      expect(queue.count()).toBe(5);
      expect(queue.toArray()).toEqual([0, 1, 2, 3, 4]);
    });

    test("空队列 map 返回空数组", () => {
      expect(queue.map((n) => n)).toEqual([]);
    });

    test("head 不在 0 位置时 filter 和 map 仍保持正确顺序", () => {
      for (let i = 0; i < 6; i++) queue.push(i);
      queue.pop(); // 0
      queue.pop(); // 1
      expect(queue.head).toBe(2);

      const filtered = queue.filter((n) => n % 2 === 0);
      expect(filtered).toEqual([2, 4]);

      const mapped = queue.map((n) => n * 10);
      expect(mapped).toEqual([20, 30, 40, 50]);
    });

    test("filter 和 map 支持链式调用（filter 后接原生数组方法）", () => {
      for (let i = 0; i < 10; i++) queue.push(i);
      const result = queue.filter((n) => n % 2 === 0).map((n) => n * 3);
      expect(result).toEqual([0, 6, 12, 18, 24]);
    });
  });

  describe("边界情况", () => {
    test("单个元素的入队出队", () => {
      queue.push(42);
      expect(queue.count()).toBe(1);
      expect(queue.pop()).toBe(42);
      expect(queue.empty()).toBe(true);
    });
  });
});
