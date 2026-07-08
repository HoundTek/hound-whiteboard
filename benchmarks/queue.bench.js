/**
 * @file Queue 性能测试
 * @description 测量 Queue 数据结构各操作的性能。
 * @module benchmarks/queue
 */

import { Queue } from "../src/core/utils/queue.js";
import { printHeader, printFooter, benchmarkSync } from "./helpers.js";

const SMALL_SIZE = 100;
const MEDIUM_SIZE = 1000;
const LARGE_SIZE = 10000;
const ROUNDS = 5;

function createFilledQueue(size) {
  const queue = new Queue();
  for (let i = 0; i < size; i++) {
    queue.push(i);
  }
  return queue;
}

printHeader("Queue 性能测试");

// Push 操作
benchmarkSync("Queue#push (单个元素)", 50000, ROUNDS, () => {
  const queue = new Queue();
  queue.push(1);
});

benchmarkSync("Queue#push (100 个元素)", 5000, ROUNDS, () => {
  const queue = new Queue();
  for (let i = 0; i < SMALL_SIZE; i++) {
    queue.push(i);
  }
});

benchmarkSync("Queue#push (1000 个元素)", 1000, ROUNDS, () => {
  const queue = new Queue();
  for (let i = 0; i < MEDIUM_SIZE; i++) {
    queue.push(i);
  }
});

// Pop 操作
benchmarkSync("Queue#pop (从 100 元素队列)", 5000, ROUNDS, () => {
  const queue = createFilledQueue(SMALL_SIZE);
  for (let i = 0; i < SMALL_SIZE; i++) {
    queue.pop();
  }
});

benchmarkSync("Queue#pop (从 1000 元素队列)", 1000, ROUNDS, () => {
  const queue = createFilledQueue(MEDIUM_SIZE);
  for (let i = 0; i < MEDIUM_SIZE; i++) {
    queue.pop();
  }
});

// Push/Pop 混合
benchmarkSync("Queue#push+pop 混合 (100 次操作)", 10000, ROUNDS, () => {
  const queue = new Queue();
  for (let i = 0; i < 50; i++) queue.push(i);
  for (let i = 0; i < 50; i++) if (!queue.empty()) queue.pop();
});

benchmarkSync("Queue#push+pop 混合 (1000 次操作)", 1000, ROUNDS, () => {
  const queue = new Queue();
  for (let i = 0; i < 500; i++) queue.push(i);
  for (let i = 0; i < 500; i++) if (!queue.empty()) queue.pop();
});

// Peek
benchmarkSync("Queue#peek (100 元素队列)", 50000, ROUNDS, () => {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.peek();
});

benchmarkSync("Queue#peek (10000 元素队列)", 50000, ROUNDS, () => {
  const queue = createFilledQueue(LARGE_SIZE);
  queue.peek();
});

// Count
benchmarkSync("Queue#count (100 元素队列)", 50000, ROUNDS, () => {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.count();
});

benchmarkSync("Queue#count (10000 元素队列)", 50000, ROUNDS, () => {
  const queue = createFilledQueue(LARGE_SIZE);
  queue.count();
});

// Empty
benchmarkSync("Queue#empty (空队列)", 50000, ROUNDS, () => {
  const queue = new Queue();
  queue.empty();
});

benchmarkSync("Queue#empty (非空队列)", 50000, ROUNDS, () => {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.empty();
});

// toArray 操作
benchmarkSync("Queue#toArray (100 元素队列)", 50000, ROUNDS, () => {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.toArray();
});

benchmarkSync("Queue#toArray (10000 元素队列)", 1000, ROUNDS, () => {
  const queue = createFilledQueue(LARGE_SIZE);
  queue.toArray();
});

// Filter 操作
benchmarkSync("Queue#filter (100 元素，筛选一半)", 50000, ROUNDS, () => {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.filter((n) => n % 2 === 0);
});

benchmarkSync("Queue#filter (10000 元素，筛选一半)", 1000, ROUNDS, () => {
  const queue = createFilledQueue(LARGE_SIZE);
  queue.filter((n) => n % 2 === 0);
});

// Map 操作
benchmarkSync("Queue#map (100 元素)", 50000, ROUNDS, () => {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.map((n) => n * 2);
});

benchmarkSync("Queue#map (10000 元素)", 1000, ROUNDS, () => {
  const queue = createFilledQueue(LARGE_SIZE);
  queue.map((n) => n * 2);
});

// 对比：toArray + filter vs 直接 filter
benchmarkSync(
  "对比：Queue#toArray().filter() (100 元素)",
  50000,
  ROUNDS,
  () => {
    const queue = createFilledQueue(SMALL_SIZE);
    queue.toArray().filter((n) => n % 2 === 0);
  },
);

benchmarkSync("对比：Queue#filter() 直接 (100 元素)", 50000, ROUNDS, () => {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.filter((n) => n % 2 === 0);
});

// 对比：toArray + filter + map vs filter + map
benchmarkSync(
  "对比：Queue#toArray().filter().map() (100 元素)",
  50000,
  ROUNDS,
  () => {
    const queue = createFilledQueue(SMALL_SIZE);
    queue
      .toArray()
      .filter((n) => n % 2 === 0)
      .map((n) => n * 3);
  },
);

benchmarkSync(
  "对比：Queue#filter().map() 链式 (100 元素)",
  50000,
  ROUNDS,
  () => {
    const queue = createFilledQueue(SMALL_SIZE);
    queue.filter((n) => n % 2 === 0).map((n) => n * 3);
  },
);

// Clear
benchmarkSync("Queue#clear (100 元素队列)", 5000, ROUNDS, () => {
  const queue = createFilledQueue(SMALL_SIZE);
  queue.clear();
});

benchmarkSync("Queue#clear (10000 元素队列)", 1000, ROUNDS, () => {
  const queue = createFilledQueue(LARGE_SIZE);
  queue.clear();
});

// 实际场景
benchmarkSync("场景：BFS 遍历模拟 (1000 节点)", 1000, ROUNDS, () => {
  const queue = new Queue();
  queue.push(0);
  let visited = 0;
  while (!queue.empty() && visited < MEDIUM_SIZE) {
    const node = queue.pop();
    visited++;
    if (visited < MEDIUM_SIZE) {
      queue.push(visited);
      if (visited + 1 < MEDIUM_SIZE) queue.push(visited + 1);
    }
  }
});

benchmarkSync("场景：任务队列处理 (500 个任务)", 1000, ROUNDS, () => {
  const queue = new Queue();
  for (let i = 0; i < 500; i++) queue.push({ id: i, data: `task-${i}` });
  while (!queue.empty()) {
    const task = queue.pop();
    if (task.id % 10 === 0) {
      queue.push({ id: task.id + 1001, data: `subtask-${task.id}` });
    }
  }
});

// 与原生数组对比
benchmarkSync("对比：Array.push + Array.shift (100 次)", 5000, ROUNDS, () => {
  const arr = [];
  for (let i = 0; i < SMALL_SIZE; i++) arr.push(i);
  for (let i = 0; i < SMALL_SIZE; i++) arr.shift();
});

benchmarkSync("对比：Queue (100 次 push + pop)", 5000, ROUNDS, () => {
  const queue = new Queue();
  for (let i = 0; i < SMALL_SIZE; i++) queue.push(i);
  for (let i = 0; i < SMALL_SIZE; i++) queue.pop();
});

printFooter();
