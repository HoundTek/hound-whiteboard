import { Chain, Node } from "../chain.js";

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
});
