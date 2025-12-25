const { Chain, Node } = require("./chain");

describe("Node", () => {
  test("构造函数应正确初始化 value 和 next", () => {
    const node = new Node(10);
    expect(node.value).toBe(10);
    expect(node.next).toBeNull();
  });
});

describe("Chain", () => {
  let chain = new Chain();

  beforeEach(() => {
    chain = new Chain();
  });
  describe("基础操作", () => {
    test("构造函数应正确初始化 head, tail 和 length", () => {
      expect(chain.head).toBeNull();
      expect(chain.tail).toBeNull();
      expect(chain.length).toBe(0);
    });

    test("append 方法应在链表末尾添加节点", () => {
      chain.append(1);
      expect(chain.length).toBe(1);
      expect(chain.head.value).toBe(1);
      expect(chain.tail.value).toBe(1);

      chain.append(2);
      expect(chain.length).toBe(2);
      expect(chain.head.value).toBe(1);
      expect(chain.tail.value).toBe(2);
      expect(chain.head.next.value).toBe(2);
    });

    test("prepend 方法应在链表开头添加节点", () => {
      chain.prepend(1);
      expect(chain.length).toBe(1);
      expect(chain.head.value).toBe(1);
      expect(chain.tail.value).toBe(1);

      chain.prepend(2);
      expect(chain.length).toBe(2);
      expect(chain.head.value).toBe(2);
      expect(chain.tail.value).toBe(1);
      expect(chain.head.next.value).toBe(1);
    });

    test("insertAt 方法应在指定位置插入节点", () => {
      chain.append(1);
      chain.append(3);
      chain.insertAt(2, 1);
      expect(chain.length).toBe(3);
      expect(chain.getAt(0)).toBe(1);
      expect(chain.getAt(1)).toBe(2);
      expect(chain.getAt(2)).toBe(3);

      chain.insertAt(0, 0); // 插入到开头
      expect(chain.length).toBe(4);
      expect(chain.getAt(0)).toBe(0);

      chain.insertAt(4, 4); // 插入到末尾
      expect(chain.length).toBe(5);
      expect(chain.getAt(4)).toBe(4);
    });

    test("insertAt 方法在索引超出范围时应抛出 RangeError", () => {
      expect(() => chain.insertAt(1, -1)).toThrow(RangeError);
      expect(() => chain.insertAt(1, 1)).toThrow(RangeError);
    });

    test("removeAt 方法应移除指定位置的节点并返回其值", () => {
      chain.append(1);
      chain.append(2);
      chain.append(3);

      expect(chain.removeAt(1)).toBe(2);
      expect(chain.length).toBe(2);
      expect(chain.getAt(0)).toBe(1);
      expect(chain.getAt(1)).toBe(3);

      expect(chain.removeAt(0)).toBe(1); // 移除头节点
      expect(chain.length).toBe(1);
      expect(chain.getAt(0)).toBe(3);
      expect(chain.head.value).toBe(3);
      expect(chain.tail.value).toBe(3);

      expect(chain.removeAt(0)).toBe(3); // 移除最后一个节点
      expect(chain.length).toBe(0);
      expect(chain.isEmpty()).toBe(true);
      expect(chain.head).toBeNull();
      expect(chain.tail).toBeNull();
    });

    test("removeAt 方法在索引超出范围或链表为空时应抛出 RangeError", () => {
      expect(() => chain.removeAt(0)).toThrow(RangeError);
      chain.append(1);
      expect(() => chain.removeAt(-1)).toThrow(RangeError);
      expect(() => chain.removeAt(1)).toThrow(RangeError);
    });

    test("getAt 方法应返回指定位置的节点值", () => {
      chain.append(1);
      chain.append(2);
      chain.append(3);
      expect(chain.getAt(0)).toBe(1);
      expect(chain.getAt(1)).toBe(2);
      expect(chain.getAt(2)).toBe(3);
    });

    test("getAt 方法在索引超出范围或链表为空时应抛出 RangeError", () => {
      expect(() => chain.getAt(0)).toThrow(RangeError);
      chain.append(1);
      expect(() => chain.getAt(-1)).toThrow(RangeError);
      expect(() => chain.getAt(1)).toThrow(RangeError);
    });

    test("indexOf 方法应返回指定值的索引", () => {
      chain.append(1);
      chain.append(2);
      chain.append(3);
      expect(chain.indexOf(1)).toBe(0);
      expect(chain.indexOf(2)).toBe(1);
      expect(chain.indexOf(3)).toBe(2);
      expect(chain.indexOf(4)).toBe(-1);
    });

    test("isEmpty 方法应正确判断链表是否为空", () => {
      expect(chain.isEmpty()).toBe(true);
      chain.append(1);
      expect(chain.isEmpty()).toBe(false);
      chain.removeAt(0);
      expect(chain.isEmpty()).toBe(true);
    });

    test("size 方法应返回正确的链表长度", () => {
      expect(chain.size()).toBe(0);
      chain.append(1);
      expect(chain.size()).toBe(1);
      chain.append(2);
      expect(chain.size()).toBe(2);
      chain.removeAt(0);
      expect(chain.size()).toBe(1);
    });

    test("clear 方法应清空链表", () => {
      chain.append(1);
      chain.append(2);
      chain.clear();
      expect(chain.isEmpty()).toBe(true);
      expect(chain.head).toBeNull();
      expect(chain.tail).toBeNull();
      expect(chain.length).toBe(0);
    });
  });

  // ========== 大数据测试 ==========
  describe("大数据测试", () => {
    test("应该能处理大量 append 操作", () => {
      const testSize = 1000;
      for (let i = 0; i < testSize; i++) {
        chain.append(i);
      }

      expect(chain.size()).toBe(testSize);
      expect(chain.head.value).toBe(0);
      expect(chain.tail.value).toBe(testSize - 1);

      // 验证部分元素
      expect(chain.getAt(0)).toBe(0);
      expect(chain.getAt(500)).toBe(500);
      expect(chain.getAt(testSize - 1)).toBe(testSize - 1);
    });

    test("应该能处理大量 prepend 操作", () => {
      const testSize = 1000;
      for (let i = 0; i < testSize; i++) {
        chain.prepend(i);
      }

      expect(chain.size()).toBe(testSize);
      expect(chain.head.value).toBe(testSize - 1);
      expect(chain.tail.value).toBe(0);

      // 验证元素顺序（应该是倒序）
      expect(chain.getAt(0)).toBe(testSize - 1);
      expect(chain.getAt(500)).toBe(testSize - 501);
      expect(chain.getAt(testSize - 1)).toBe(0);
    });

    test("大量数据的 indexOf 查找", () => {
      const testSize = 1000;
      for (let i = 0; i < testSize; i++) {
        chain.append(i);
      }

      // 查找开头、中间、末尾元素
      expect(chain.indexOf(0)).toBe(0);
      expect(chain.indexOf(500)).toBe(500);
      expect(chain.indexOf(testSize - 1)).toBe(testSize - 1);
      expect(chain.indexOf(testSize)).toBe(-1);
    });

    test("大量数据的 removeAt 操作", () => {
      const testSize = 500;
      for (let i = 0; i < testSize; i++) {
        chain.append(i);
      }

      // 从末尾移除一半元素
      for (let i = 0; i < testSize / 2; i++) {
        chain.removeAt(chain.size() - 1);
      }

      expect(chain.size()).toBe(testSize / 2);
      expect(chain.tail.value).toBe(testSize / 2 - 1);
    });

    test("大量数据的 insertAt 操作", () => {
      // 先构建基础链表
      for (let i = 0; i < 100; i += 2) {
        chain.append(i);
      }

      // 在奇数位置插入元素
      for (let i = 1; i < 100; i += 2) {
        chain.insertAt(i, i);
      }

      expect(chain.size()).toBe(100);

      // 验证顺序正确
      for (let i = 0; i < 100; i++) {
        expect(chain.getAt(i)).toBe(i);
      }
    });

    test("大量混合操作的性能和正确性", () => {
      // 添加
      for (let i = 0; i < 200; i++) {
        chain.append(i);
      }

      // 移除前 50 个
      for (let i = 0; i < 50; i++) {
        chain.removeAt(0);
      }

      // 在开头添加
      for (let i = 0; i < 30; i++) {
        chain.prepend(-i - 1);
      }

      // 验证长度
      expect(chain.size()).toBe(180); // (200 - 50) + 30

      // 移除末尾 30 个
      for (let i = 0; i < 30; i++) {
        chain.removeAt(chain.size() - 1);
      }

      expect(chain.size()).toBe(150);
    });

    test("大量数据遍历所有元素", () => {
      const testSize = 500;
      for (let i = 0; i < testSize; i++) {
        chain.append(i);
      }

      // 通过 getAt 遍历所有元素
      for (let i = 0; i < testSize; i++) {
        expect(chain.getAt(i)).toBe(i);
      }

      expect(chain.size()).toBe(testSize);
    });
  });

  // ========== undefined 和 null 值测试 ==========
  describe("undefined 和 null 值处理", () => {
    test("应该能正确存储和检索 undefined", () => {
      chain.append(undefined);
      expect(chain.size()).toBe(1);
      expect(chain.getAt(0)).toBeUndefined();
      expect(chain.head.value).toBeUndefined();
      expect(chain.tail.value).toBeUndefined();
    });

    test("应该能正确存储和检索 null", () => {
      chain.append(null);
      expect(chain.size()).toBe(1);
      expect(chain.getAt(0)).toBeNull();
      expect(chain.head.value).toBeNull();
      expect(chain.tail.value).toBeNull();
    });

    test("应该能区分 undefined 和 null", () => {
      chain.append(undefined);
      chain.append(null);
      chain.append(0);
      chain.append("");
      chain.append(false);

      expect(chain.size()).toBe(5);
      expect(chain.getAt(0)).toBeUndefined();
      expect(chain.getAt(1)).toBeNull();
      expect(chain.getAt(2)).toBe(0);
      expect(chain.getAt(3)).toBe("");
      expect(chain.getAt(4)).toBe(false);
    });

    test("indexOf 应该能找到 undefined", () => {
      chain.append(1);
      chain.append(undefined);
      chain.append(2);

      expect(chain.indexOf(undefined)).toBe(1);
    });

    test("indexOf 应该能找到 null", () => {
      chain.append(1);
      chain.append(null);
      chain.append(2);

      expect(chain.indexOf(null)).toBe(1);
    });

    test("应该能 prepend undefined 和 null", () => {
      chain.prepend(undefined);
      chain.prepend(null);

      expect(chain.size()).toBe(2);
      expect(chain.getAt(0)).toBeNull();
      expect(chain.getAt(1)).toBeUndefined();
    });

    test("应该能 insertAt undefined 和 null", () => {
      chain.append(1);
      chain.append(3);
      chain.insertAt(undefined, 1);
      chain.insertAt(null, 2);

      expect(chain.size()).toBe(4);
      expect(chain.getAt(0)).toBe(1);
      expect(chain.getAt(1)).toBeUndefined();
      expect(chain.getAt(2)).toBeNull();
      expect(chain.getAt(3)).toBe(3);
    });

    test("应该能 removeAt undefined 和 null", () => {
      chain.append(undefined);
      chain.append(null);
      chain.append(1);

      expect(chain.removeAt(0)).toBeUndefined();
      expect(chain.removeAt(0)).toBeNull();
      expect(chain.size()).toBe(1);
    });

    test("混合 undefined、null 和其他值", () => {
      const values = [null, undefined, 0, "", false, true, 1, "test"];
      values.forEach((val) => chain.append(val));

      expect(chain.size()).toBe(values.length);

      values.forEach((val, index) => {
        if (val === null) {
          expect(chain.getAt(index)).toBeNull();
        } else if (val === undefined) {
          expect(chain.getAt(index)).toBeUndefined();
        } else {
          expect(chain.getAt(index)).toBe(val);
        }
      });
    });
  });

  // ========== 反复填充和清空测试 ==========
  describe("反复填充和清空", () => {
    test("应该能多次填充和清空", () => {
      for (let round = 0; round < 5; round++) {
        // 填充
        for (let i = 0; i < 100; i++) {
          chain.append(i);
        }
        expect(chain.size()).toBe(100);
        expect(chain.head.value).toBe(0);
        expect(chain.tail.value).toBe(99);

        // 清空
        chain.clear();
        expect(chain.isEmpty()).toBe(true);
        expect(chain.head).toBeNull();
        expect(chain.tail).toBeNull();
        expect(chain.size()).toBe(0);
      }
    });

    test("通过 removeAt 反复清空和填充", () => {
      for (let round = 0; round < 3; round++) {
        // 填充
        for (let i = 0; i < 50; i++) {
          chain.append(i);
        }
        expect(chain.size()).toBe(50);

        // 通过 removeAt 清空
        while (!chain.isEmpty()) {
          chain.removeAt(0);
        }
        expect(chain.isEmpty()).toBe(true);
        expect(chain.head).toBeNull();
        expect(chain.tail).toBeNull();
      }
    });

    test("交替使用 append 和 prepend 反复填充", () => {
      for (let round = 0; round < 3; round++) {
        // 使用 append
        for (let i = 0; i < 30; i++) {
          chain.append(i);
        }
        expect(chain.size()).toBe(30);

        chain.clear();

        // 使用 prepend
        for (let i = 0; i < 30; i++) {
          chain.prepend(i);
        }
        expect(chain.size()).toBe(30);

        chain.clear();
      }
    });

    test("部分填充和部分清空的循环", () => {
      for (let round = 0; round < 5; round++) {
        // 添加 20 个元素
        for (let i = 0; i < 20; i++) {
          chain.append(round * 100 + i);
        }

        // 移除 10 个元素
        for (let i = 0; i < 10; i++) {
          chain.removeAt(0);
        }
      }

      // 最终应该有 50 个元素
      expect(chain.size()).toBe(50);
    });

    test("清空后应该能正常添加新元素", () => {
      // 第一次填充
      chain.append(1);
      chain.append(2);
      chain.clear();

      // 清空后添加
      chain.append(10);
      expect(chain.size()).toBe(1);
      expect(chain.head.value).toBe(10);
      expect(chain.tail.value).toBe(10);

      // 继续添加
      chain.append(20);
      expect(chain.size()).toBe(2);
      expect(chain.getAt(0)).toBe(10);
      expect(chain.getAt(1)).toBe(20);
    });
  });

  // ========== 边界情况和特殊数据类型 ==========
  describe("边界情况和特殊数据类型", () => {
    test("单个元素操作", () => {
      chain.append(42);
      expect(chain.size()).toBe(1);
      expect(chain.head).toBe(chain.tail);
      expect(chain.removeAt(0)).toBe(42);
      expect(chain.isEmpty()).toBe(true);
    });

    test("应该正确处理对象", () => {
      const obj1 = { id: 1, name: "test1" };
      const obj2 = { id: 2, name: "test2" };

      chain.append(obj1);
      chain.append(obj2);

      expect(chain.getAt(0)).toBe(obj1);
      expect(chain.getAt(1)).toBe(obj2);
      expect(chain.indexOf(obj1)).toBe(0);
    });

    test("应该正确处理数组", () => {
      const arr1 = [1, 2, 3];
      const arr2 = [4, 5, 6];

      chain.append(arr1);
      chain.append(arr2);

      expect(chain.getAt(0)).toBe(arr1);
      expect(chain.getAt(1)).toBe(arr2);
    });

    test("应该正确处理函数", () => {
      const fn1 = () => 1;
      const fn2 = () => 2;

      chain.append(fn1);
      chain.append(fn2);

      expect(chain.getAt(0)).toBe(fn1);
      expect(chain.getAt(1)).toBe(fn2);
      expect(chain.getAt(0)()).toBe(1);
    });

    test("应该正确处理 Symbol", () => {
      const sym1 = Symbol("test1");
      const sym2 = Symbol("test2");

      chain.append(sym1);
      chain.append(sym2);

      expect(chain.getAt(0)).toBe(sym1);
      expect(chain.getAt(1)).toBe(sym2);
      expect(chain.indexOf(sym1)).toBe(0);
    });

    test("应该正确处理 Date", () => {
      const date1 = new Date("2024-01-01");
      const date2 = new Date("2024-12-31");

      chain.append(date1);
      chain.append(date2);

      expect(chain.getAt(0)).toBe(date1);
      expect(chain.getAt(1)).toBe(date2);
    });

    test("应该正确处理正则表达式", () => {
      const regex1 = /test1/g;
      const regex2 = /test2/i;

      chain.append(regex1);
      chain.append(regex2);

      expect(chain.getAt(0)).toBe(regex1);
      expect(chain.getAt(1)).toBe(regex2);
    });

    test("混合各种数据类型", () => {
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
        () => "function",
      ];

      testData.forEach((data) => chain.append(data));
      expect(chain.size()).toBe(testData.length);

      testData.forEach((data, index) => {
        if (typeof data === "symbol") {
          expect(typeof chain.getAt(index)).toBe("symbol");
        } else {
          expect(chain.getAt(index)).toBe(data);
        }
      });
    });
  });
});
