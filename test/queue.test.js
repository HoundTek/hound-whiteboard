const { Queue } = require("../src/utils/queue");

describe("Queue", () => {
  let queue = new Queue();

  beforeEach(() => {
    queue = new Queue();
  });

	test("构造函数应正确初始化 elements, head 和 tail", () => {
	   expect(queue.elements).toEqual({});
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
});
