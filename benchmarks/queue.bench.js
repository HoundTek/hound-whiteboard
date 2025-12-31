/**
 * @file Queue 性能测试
 * @module benchmarks/queue
 */

const Benchmark = require("benchmark");
const { Queue } = require("../src/utils/queue");

const suite = new Benchmark.Suite("Queue Benchmarks");

// 测试数据准备
const SMALL_SIZE = 100;
const MEDIUM_SIZE = 1000;
const LARGE_SIZE = 10000;

// 辅助函数：创建预填充的队列
function createFilledQueue(size) {
  const queue = new Queue();
  for (let i = 0; i < size; i++) {
    queue.push(i);
  }
  return queue;
}

// ========== Push 操作测试 ==========
suite.add("Queue#push (单个元素)", function () {
  const queue = new Queue();
  queue.push(1);
});

suite.add("Queue#push (100 个元素)", function () {
  const queue = new Queue();
  for (let i = 0; i < SMALL_SIZE; i++) {
    queue.push(i);
  }
});

suite.add("Queue#push (1000 个元素)", function () {
  const queue = new Queue();
  for (let i = 0; i < MEDIUM_SIZE; i++) {
    queue.push(i);
  }
});

// ========== Pop 操作测试 ==========
suite.add("Queue#pop (从 100 元素队列)", function () {
  const queue = createFilledQueue(SMALL_SIZE);
  for (let i = 0; i < SMALL_SIZE; i++) {
    queue.pop();
  }
});

suite.add("Queue#pop (从 1000 元素队列)", function () {
  const queue = createFilledQueue(MEDIUM_SIZE);
  for (let i = 0; i < MEDIUM_SIZE; i++) {
    queue.pop();
  }
});

// ========== Push/Pop 混合操作测试 ==========
suite.add("Queue#push+pop 混合 (100 次操作)", function () {
  const queue = new Queue();
  for (let i = 0; i < 50; i++) {
    queue.push(i);
  }
  for (let i = 0; i < 50; i++) {
    if (!queue.empty()) {
      queue.pop();
    }
  }
});

suite.add("Queue#push+pop 混合 (1000 次操作)", function () {
  const queue = new Queue();
  for (let i = 0; i < 500; i++) {
    queue.push(i);
  }
  for (let i = 0; i < 500; i++) {
    if (!queue.empty()) {
      queue.pop();
    }
  }
});

// ========== Peek 操作测试 ==========
suite.add("Queue#peek (100 元素队列)", function () {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.peek();
});

suite.add("Queue#peek (10000 元素队列)", function () {
  const queue = createFilledQueue(LARGE_SIZE);
  queue.peek();
});

// ========== Count 操作测试 ==========
suite.add("Queue#count (100 元素队列)", function () {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.count();
});

suite.add("Queue#count (10000 元素队列)", function () {
  const queue = createFilledQueue(LARGE_SIZE);
  queue.count();
});

// ========== Empty 操作测试 ==========
suite.add("Queue#empty (空队列)", function () {
  const queue = new Queue();
  queue.empty();
});

suite.add("Queue#empty (非空队列)", function () {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.empty();
});

// ========== Clear 操作测试 ==========
suite.add("Queue#clear (100 元素队列)", function () {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.clear();
});

suite.add("Queue#clear (10000 元素队列)", function () {
  const queue = createFilledQueue(LARGE_SIZE);
  queue.clear();
});

// ========== 实际应用场景测试 ==========
suite.add("场景：BFS 遍历模拟 (1000 节点)", function () {
  const queue = new Queue();
  queue.push(0);
  let visited = 0;

  while (!queue.empty() && visited < MEDIUM_SIZE) {
    const node = queue.pop();
    visited++;

    // 模拟添加子节点
    if (visited < MEDIUM_SIZE) {
      queue.push(visited);
      if (visited + 1 < MEDIUM_SIZE) {
        queue.push(visited + 1);
      }
    }
  }
});

suite.add("场景：任务队列处理 (500 个任务)", function () {
  const queue = new Queue();

  // 添加任务
  for (let i = 0; i < 500; i++) {
    queue.push({ id: i, data: `task-${i}` });
  }

  // 处理任务
  while (!queue.empty()) {
    const task = queue.pop();
    // 模拟任务处理（检查 id）
    if (task.id % 10 === 0) {
      // 某些任务可能产生新任务
      queue.push({ id: task.id + 1001, data: `subtask-${task.id}` });
    }
  }
});

// ========== 与原生数组对比 ==========
suite.add("对比：Array.push + Array.shift (100 次)", function () {
  const arr = [];
  for (let i = 0; i < SMALL_SIZE; i++) {
    arr.push(i);
  }
  for (let i = 0; i < SMALL_SIZE; i++) {
    arr.shift();
  }
});

suite.add("对比：Queue (100 次 push + pop)", function () {
  const queue = new Queue();
  for (let i = 0; i < SMALL_SIZE; i++) {
    queue.push(i);
  }
  for (let i = 0; i < SMALL_SIZE; i++) {
    queue.pop();
  }
});

// 配置输出
suite.on("cycle", function (event) {
  console.log(String(event.target));
});

suite.on("complete", function () {
  console.log("\n性能测试完成！");
  console.log("═══════════════════════════════════════════════════");
});

// 运行测试
console.log("开始 Queue 性能测试...\n");
console.log("═══════════════════════════════════════════════════");
suite.run({ async: true });
