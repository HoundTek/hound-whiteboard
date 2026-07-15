import { Deque } from "../deque.js";

describe("Deque", () => {
  let deque = new Deque();

  beforeEach(() => {
    deque = new Deque();
  });

  describe("基础操作", () => {
    test("构造函数应正确初始化 elements, head 和 tail", () => {
      expect(deque.elements).toEqual(new Array(8));
      expect(deque.head).toBe(0);
      expect(deque.tail).toBe(0);
    });

    test("pushBack 方法应正确从队尾添加元素", () => {
      deque.pushBack(1);
      expect(deque.count()).toBe(1);
      expect(deque.peekFront()).toBe(1);
      expect(deque.peekBack()).toBe(1);

      deque.pushBack(2);
      expect(deque.count()).toBe(2);
      expect(deque.peekFront()).toBe(1);
      expect(deque.peekBack()).toBe(2);
    });

    test("pushFront 方法应正确从队头添加元素", () => {
      deque.pushFront(1);
      expect(deque.count()).toBe(1);
      expect(deque.peekFront()).toBe(1);
      expect(deque.peekBack()).toBe(1);

      deque.pushFront(2);
      expect(deque.count()).toBe(2);
      expect(deque.peekFront()).toBe(2);
      expect(deque.peekBack()).toBe(1);
    });

    test("popFront 方法应正确从队头移除并返回元素", () => {
      deque.pushBack(1);
      deque.pushBack(2);
      deque.pushBack(3);

      expect(deque.popFront()).toBe(1);
      expect(deque.count()).toBe(2);
      expect(deque.peekFront()).toBe(2);

      expect(deque.popFront()).toBe(2);
      expect(deque.count()).toBe(1);
      expect(deque.peekFront()).toBe(3);

      expect(deque.popFront()).toBe(3);
      expect(deque.count()).toBe(0);
      expect(deque.empty()).toBe(true);
    });

    test("popBack 方法应正确从队尾移除并返回元素", () => {
      deque.pushBack(1);
      deque.pushBack(2);
      deque.pushBack(3);

      expect(deque.popBack()).toBe(3);
      expect(deque.count()).toBe(2);
      expect(deque.peekBack()).toBe(2);

      expect(deque.popBack()).toBe(2);
      expect(deque.count()).toBe(1);
      expect(deque.peekBack()).toBe(1);

      expect(deque.popBack()).toBe(1);
      expect(deque.count()).toBe(0);
      expect(deque.empty()).toBe(true);
    });

    test("popFront 方法在队列为空时应抛出 RangeError", () => {
      expect(() => deque.popFront()).toThrow(RangeError);
      expect(() => deque.popFront()).toThrow("Deque is empty");
    });

    test("popBack 方法在队列为空时应抛出 RangeError", () => {
      expect(() => deque.popBack()).toThrow(RangeError);
      expect(() => deque.popBack()).toThrow("Deque is empty");
    });

    test("count 方法应返回正确的元素数量", () => {
      expect(deque.count()).toBe(0);

      deque.pushBack(1);
      expect(deque.count()).toBe(1);

      deque.pushFront(2);
      expect(deque.count()).toBe(2);

      deque.popFront();
      expect(deque.count()).toBe(1);

      deque.popBack();
      expect(deque.count()).toBe(0);
    });

    test("empty 方法应正确判断队列是否为空", () => {
      expect(deque.empty()).toBe(true);

      deque.pushBack(1);
      expect(deque.empty()).toBe(false);

      deque.popFront();
      expect(deque.empty()).toBe(true);

      deque.pushFront(1);
      expect(deque.empty()).toBe(false);

      deque.popBack();
      expect(deque.empty()).toBe(true);
    });

    test("peekFront 方法应返回队头元素而不移除它", () => {
      deque.pushBack(1);
      deque.pushBack(2);

      expect(deque.peekFront()).toBe(1);
      expect(deque.count()).toBe(2); // peek 不改变队列大小
      expect(deque.peekFront()).toBe(1);
    });

    test("peekBack 方法应返回队尾元素而不移除它", () => {
      deque.pushBack(1);
      deque.pushBack(2);

      expect(deque.peekBack()).toBe(2);
      expect(deque.count()).toBe(2); // peek 不改变队列大小
      expect(deque.peekBack()).toBe(2);
    });

    test("peekFront 方法在队列为空时应抛出 RangeError", () => {
      expect(() => deque.peekFront()).toThrow(RangeError);
      expect(() => deque.peekFront()).toThrow("Deque is empty");
    });

    test("peekBack 方法在队列为空时应抛出 RangeError", () => {
      expect(() => deque.peekBack()).toThrow(RangeError);
      expect(() => deque.peekBack()).toThrow("Deque is empty");
    });

    test("clear 方法应清空队列", () => {
      deque.pushBack(1);
      deque.pushFront(2);
      deque.pushBack(3);
      expect(deque.count()).toBe(3);

      deque.clear();
      expect(deque.count()).toBe(0);
      expect(deque.empty()).toBe(true);
      expect(() => deque.peekFront()).toThrow(RangeError);
      expect(() => deque.peekBack()).toThrow(RangeError);
    });

    test("toArray 方法应返回当前顺序的数组副本", () => {
      deque.pushBack(1);
      deque.pushFront(0);
      deque.pushBack(2);

      expect(deque.toArray()).toEqual([0, 1, 2]);
      expect(deque.count()).toBe(3);
    });

    test("includes 方法应正确判断元素是否存在", () => {
      const target = { id: 2 };

      deque.pushBack({ id: 1 });
      deque.pushBack(target);

      expect(deque.includes(target)).toBe(true);
      expect(deque.includes({ id: 2 })).toBe(false);
    });
  });

  describe("混合操作", () => {
    test("混合使用 pushFront 和 pushBack", () => {
      deque.pushBack(1);
      deque.pushFront(2);
      deque.pushBack(3);
      deque.pushFront(4);

      // 预期顺序: 4 -> 2 -> 1 -> 3
      expect(deque.count()).toBe(4);
      expect(deque.peekFront()).toBe(4);
      expect(deque.peekBack()).toBe(3);

      expect(deque.popFront()).toBe(4);
      expect(deque.popFront()).toBe(2);
      expect(deque.popFront()).toBe(1);
      expect(deque.popFront()).toBe(3);
      expect(deque.empty()).toBe(true);
    });

    test("混合使用 popFront 和 popBack", () => {
      deque.pushBack(1);
      deque.pushBack(2);
      deque.pushBack(3);
      deque.pushBack(4);

      // 从两端移除
      expect(deque.popFront()).toBe(1); // 剩余: 2, 3, 4
      expect(deque.popBack()).toBe(4); // 剩余: 2, 3
      expect(deque.popFront()).toBe(2); // 剩余: 3
      expect(deque.popBack()).toBe(3); // 剩余: 空

      expect(deque.empty()).toBe(true);
    });

    test("交替从两端添加和移除", () => {
      deque.pushBack(1);
      deque.pushFront(2);
      expect(deque.popBack()).toBe(1);
      deque.pushBack(3);
      expect(deque.popFront()).toBe(2);
      deque.pushFront(4);

      // 预期顺序: 4 -> 3
      expect(deque.count()).toBe(2);
      expect(deque.peekFront()).toBe(4);
      expect(deque.peekBack()).toBe(3);
    });

    test("先从队头添加，再从队尾移除", () => {
      for (let i = 0; i < 5; i++) {
        deque.pushFront(i);
      }

      // pushFront 顺序: 4 -> 3 -> 2 -> 1 -> 0
      expect(deque.count()).toBe(5);
      expect(deque.peekFront()).toBe(4);
      expect(deque.peekBack()).toBe(0);

      for (let i = 0; i < 5; i++) {
        expect(deque.popBack()).toBe(i);
      }
      expect(deque.empty()).toBe(true);
    });

    test("先从队尾添加，再从队头移除", () => {
      for (let i = 0; i < 5; i++) {
        deque.pushBack(i);
      }

      // pushBack 顺序: 0 -> 1 -> 2 -> 3 -> 4
      expect(deque.count()).toBe(5);
      expect(deque.peekFront()).toBe(0);
      expect(deque.peekBack()).toBe(4);

      for (let i = 0; i < 5; i++) {
        expect(deque.popFront()).toBe(i);
      }
      expect(deque.empty()).toBe(true);
    });
  });

  describe("动态扩容", () => {
    test("pushBack 触发扩容", () => {
      // 初始容量为 8，可以存放 7 个元素（需要预留 1 个空位）
      for (let i = 0; i < 7; i++) {
        deque.pushBack(i);
      }
      expect(deque.count()).toBe(7);
      expect(deque.capacity).toBe(8);

      // 再添加一个元素应该触发扩容
      deque.pushBack(7);
      expect(deque.count()).toBe(8);
      expect(deque.capacity).toBe(16); // 扩容因子为 2
    });

    test("pushFront 触发扩容", () => {
      for (let i = 0; i < 7; i++) {
        deque.pushFront(i);
      }
      expect(deque.count()).toBe(7);
      expect(deque.capacity).toBe(8);

      // 再添加一个元素应该触发扩容
      deque.pushFront(7);
      expect(deque.count()).toBe(8);
      expect(deque.capacity).toBe(16);
    });

    test("混合操作触发扩容", () => {
      for (let i = 0; i < 4; i++) {
        deque.pushBack(i);
      }
      for (let i = 4; i < 7; i++) {
        deque.pushFront(i);
      }

      expect(deque.count()).toBe(7);
      expect(deque.capacity).toBe(8);

      // 触发扩容
      deque.pushBack(7);
      expect(deque.count()).toBe(8);
      expect(deque.capacity).toBe(16);
    });

    test("扩容后元素顺序应保持正确（pushBack）", () => {
      for (let i = 0; i < 10; i++) {
        deque.pushBack(i);
      }

      // 验证元素顺序
      for (let i = 0; i < 10; i++) {
        expect(deque.popFront()).toBe(i);
      }
      expect(deque.empty()).toBe(true);
    });

    test("扩容后元素顺序应保持正确（pushFront）", () => {
      for (let i = 0; i < 10; i++) {
        deque.pushFront(i);
      }

      // 验证元素顺序（pushFront 是反向的）
      for (let i = 0; i < 10; i++) {
        expect(deque.popFront()).toBe(9 - i);
      }
      expect(deque.empty()).toBe(true);
    });

    test("扩容后 peek 应该返回正确的元素", () => {
      for (let i = 0; i < 10; i++) {
        deque.pushBack(i);
      }

      expect(deque.peekFront()).toBe(0);
      expect(deque.peekBack()).toBe(9);

      deque.popFront();
      deque.popBack();

      expect(deque.peekFront()).toBe(1);
      expect(deque.peekBack()).toBe(8);
    });

    test("应该支持多次扩容", () => {
      // 第一次扩容：8 -> 16
      for (let i = 0; i < 8; i++) {
        deque.pushBack(i);
      }
      expect(deque.capacity).toBe(16);

      // 第二次扩容：16 -> 32
      for (let i = 8; i < 16; i++) {
        deque.pushBack(i);
      }
      expect(deque.capacity).toBe(32);

      // 第三次扩容：32 -> 64
      for (let i = 16; i < 32; i++) {
        deque.pushBack(i);
      }
      expect(deque.capacity).toBe(64);

      // 验证所有元素都在
      expect(deque.count()).toBe(32);
    });

    test("循环数组扩容时应正确处理 head 不在 0 位置的情况", () => {
      // 先添加一些元素
      for (let i = 0; i < 5; i++) {
        deque.pushBack(i);
      }

      // 移除一些元素，使 head 移动
      deque.popFront(); // 0
      deque.popFront(); // 1
      expect(deque.head).toBe(2);
      expect(deque.count()).toBe(3);

      // 继续添加元素直到触发扩容
      for (let i = 5; i < 10; i++) {
        deque.pushBack(i);
      }

      // 验证元素顺序正确（应该从 2 开始）
      expect(deque.count()).toBe(8);
      expect(deque.popFront()).toBe(2);
      expect(deque.popFront()).toBe(3);
      expect(deque.popFront()).toBe(4);
      expect(deque.popFront()).toBe(5);
    });

    test("pushFront 使 head 在数组末尾时扩容", () => {
      // 先添加元素，然后移除，使 head 移动
      for (let i = 0; i < 5; i++) {
        deque.pushBack(i);
      }
      for (let i = 0; i < 2; i++) {
        deque.popFront();
      }

      // 现在 head 在索引 2，继续添加直到满（容量为8，预留1位，最多7个元素）
      // 当前有 3 个元素（索引 2,3,4），再添加 4 个就满了
      for (let i = 5; i < 9; i++) {
        deque.pushBack(i);
      }

      // 现在有 7 个元素，满了，使用 pushFront 触发扩容
      expect(deque.count()).toBe(7);
      deque.pushFront(100);

      expect(deque.capacity).toBe(16);
      expect(deque.peekFront()).toBe(100);
      expect(deque.count()).toBe(8);
    });

    test("扩容后 clear 应该重置容量", () => {
      // 触发扩容
      for (let i = 0; i < 20; i++) {
        deque.pushBack(i);
      }
      expect(deque.capacity).toBeGreaterThan(8);

      // 清空队列
      deque.clear();
      expect(deque.capacity).toBe(8); // 应该重置为初始容量
      expect(deque.count()).toBe(0);
      expect(deque.empty()).toBe(true);
    });
  });

  describe("边界情况", () => {
    test("单个元素的各种操作", () => {
      deque.pushBack(42);
      expect(deque.count()).toBe(1);
      expect(deque.peekFront()).toBe(42);
      expect(deque.peekBack()).toBe(42);
      expect(deque.popFront()).toBe(42);
      expect(deque.empty()).toBe(true);

      deque.pushFront(42);
      expect(deque.count()).toBe(1);
      expect(deque.peekFront()).toBe(42);
      expect(deque.peekBack()).toBe(42);
      expect(deque.popBack()).toBe(42);
      expect(deque.empty()).toBe(true);
    });

    test("两端同时操作到只剩一个元素", () => {
      for (let i = 0; i < 10; i++) {
        deque.pushBack(i);
      }

      // 从两端移除直到只剩一个
      while (deque.count() > 1) {
        deque.popFront();
        if (deque.count() > 1) {
          deque.popBack();
        }
      }

      expect(deque.count()).toBe(1);
      expect(deque.peekFront()).toBe(deque.peekBack());
    });

    test("极端情况：pushFront 后立即 popFront", () => {
      for (let i = 0; i < 10; i++) {
        deque.pushFront(i);
        expect(deque.popFront()).toBe(i);
      }
      expect(deque.empty()).toBe(true);
    });

    test("极端情况：pushBack 后立即 popBack", () => {
      for (let i = 0; i < 10; i++) {
        deque.pushBack(i);
        expect(deque.popBack()).toBe(i);
      }
      expect(deque.empty()).toBe(true);
    });

    test("交叉操作：pushFront 后 popBack", () => {
      for (let i = 0; i < 10; i++) {
        deque.pushFront(i);
      }
      // pushFront: 9, 8, 7, 6, 5, 4, 3, 2, 1, 0
      // popBack 应该按: 0, 1, 2, ...
      for (let i = 0; i < 10; i++) {
        expect(deque.popBack()).toBe(i);
      }
      expect(deque.empty()).toBe(true);
    });

    test("交叉操作：pushBack 后 popFront", () => {
      for (let i = 0; i < 10; i++) {
        deque.pushBack(i);
      }
      // pushBack: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9
      // popFront 应该按: 0, 1, 2, ...
      for (let i = 0; i < 10; i++) {
        expect(deque.popFront()).toBe(i);
      }
      expect(deque.empty()).toBe(true);
    });
  });
});
