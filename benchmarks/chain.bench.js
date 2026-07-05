/**
 * @file Chain 性能测试
 * @description 测量 Chain 数据结构各操作的性能。
 * @module benchmarks/chain
 */

import { Chain } from "../src/core/utils/chain.js";
import { printHeader, printFooter, benchmarkSync } from "./helpers.js";

const SMALL_SIZE = 100;
const MEDIUM_SIZE = 1000;
const LARGE_SIZE = 10000;
const ROUNDS = 5;

function createFilledChain(size) {
  const chain = new Chain();
  for (let i = 0; i < size; i++) chain.append(i);
  return chain;
}

printHeader("Chain 性能测试");

// ========== Append ==========
benchmarkSync("Chain#append (单个元素)", 50000, ROUNDS, () => {
  const chain = new Chain();
  chain.append(1);
});

benchmarkSync("Chain#append (100 个元素)", 5000, ROUNDS, () => {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) chain.append(i);
});

benchmarkSync("Chain#append (1000 个元素)", 1000, ROUNDS, () => {
  const chain = new Chain();
  for (let i = 0; i < MEDIUM_SIZE; i++) chain.append(i);
});

// ========== Prepend ==========
benchmarkSync("Chain#prepend (单个元素)", 50000, ROUNDS, () => {
  const chain = new Chain();
  chain.prepend(1);
});

benchmarkSync("Chain#prepend (100 个元素)", 5000, ROUNDS, () => {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) chain.prepend(i);
});

benchmarkSync("Chain#prepend (1000 个元素)", 1000, ROUNDS, () => {
  const chain = new Chain();
  for (let i = 0; i < MEDIUM_SIZE; i++) chain.prepend(i);
});

// ========== InsertAt ==========
benchmarkSync("Chain#insertAt (开头位置，100 次)", 5000, ROUNDS, () => {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) chain.insertAt(i, 0);
});

benchmarkSync("Chain#insertAt (中间位置，100 次)", 1000, ROUNDS, () => {
  const chain = createFilledChain(SMALL_SIZE);
  for (let i = 0; i < 50; i++) chain.insertAt(i, Math.floor(chain.size() / 2));
});

benchmarkSync("Chain#insertAt (末尾位置，100 次)", 5000, ROUNDS, () => {
  const chain = createFilledChain(SMALL_SIZE);
  for (let i = 0; i < SMALL_SIZE; i++) chain.insertAt(i, chain.size());
});

// ========== RemoveAt ==========
benchmarkSync("Chain#removeAt (开头位置，100 次)", 5000, ROUNDS, () => {
  const chain = createFilledChain(200);
  for (let i = 0; i < SMALL_SIZE; i++) chain.removeAt(0);
});

benchmarkSync("Chain#removeAt (中间位置，50 次)", 5000, ROUNDS, () => {
  const chain = createFilledChain(SMALL_SIZE);
  for (let i = 0; i < 50; i++) {
    if (chain.size() > 0) chain.removeAt(Math.floor(chain.size() / 2));
  }
});

benchmarkSync("Chain#removeAt (末尾位置，100 次)", 5000, ROUNDS, () => {
  const chain = createFilledChain(200);
  for (let i = 0; i < SMALL_SIZE; i++) chain.removeAt(chain.size() - 1);
});

// ========== GetAt ==========
benchmarkSync("Chain#getAt (100 元素链表，首元素)", 50000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).getAt(0);
});

benchmarkSync("Chain#getAt (100 元素链表，中间元素)", 50000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).getAt(50);
});

benchmarkSync("Chain#getAt (100 元素链表，末尾元素)", 50000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).getAt(99);
});

benchmarkSync("Chain#getAt (1000 元素链表，中间元素)", 5000, ROUNDS, () => {
  createFilledChain(MEDIUM_SIZE).getAt(500);
});

// ========== IndexOf ==========
benchmarkSync("Chain#indexOf (100 元素，查找首元素)", 50000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).indexOf(0);
});

benchmarkSync("Chain#indexOf (100 元素，查找中间元素)", 50000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).indexOf(50);
});

benchmarkSync("Chain#indexOf (100 元素，查找末尾元素)", 50000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).indexOf(99);
});

benchmarkSync("Chain#indexOf (100 元素，查找不存在元素)", 50000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).indexOf(-1);
});

benchmarkSync("Chain#indexOf (1000 元素，查找中间元素)", 5000, ROUNDS, () => {
  createFilledChain(MEDIUM_SIZE).indexOf(500);
});

// ========== Size & IsEmpty ==========
benchmarkSync("Chain#size (100 元素链表)", 50000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).size();
});

benchmarkSync("Chain#size (10000 元素链表)", 50000, ROUNDS, () => {
  createFilledChain(LARGE_SIZE).size();
});

benchmarkSync("Chain#isEmpty (空链表)", 50000, ROUNDS, () => {
  new Chain().isEmpty();
});

benchmarkSync("Chain#isEmpty (非空链表)", 50000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).isEmpty();
});

// ========== Clear ==========
benchmarkSync("Chain#clear (100 元素链表)", 5000, ROUNDS, () => {
  createFilledChain(SMALL_SIZE).clear();
});

benchmarkSync("Chain#clear (10000 元素链表)", 1000, ROUNDS, () => {
  createFilledChain(LARGE_SIZE).clear();
});

// ========== 场景 ==========
benchmarkSync("场景：构建链表并遍历 (500 节点)", 1000, ROUNDS, () => {
  const chain = new Chain();
  for (let i = 0; i < 500; i++) chain.append(i);
  for (let i = 0; i < chain.size(); i++) chain.getAt(i);
});

benchmarkSync("场景：LRU 缓存模拟 (200 次操作)", 1000, ROUNDS, () => {
  const chain = new Chain();
  for (let i = 0; i < 200; i++) {
    const index = chain.indexOf(i % 50);
    if (index !== -1) {
      chain.append(chain.removeAt(index));
    } else {
      if (chain.size() >= 100) chain.removeAt(0);
      chain.append(i % 50);
    }
  }
});

benchmarkSync("场景：链表反转 (200 个元素)", 1000, ROUNDS, () => {
  const chain = createFilledChain(200);
  const reversed = new Chain();
  while (!chain.isEmpty()) reversed.prepend(chain.removeAt(0));
});

benchmarkSync("场景：有序插入 (100 个随机数)", 1000, ROUNDS, () => {
  const chain = new Chain();
  const numbers = Array.from({ length: 100 }, () =>
    Math.floor(Math.random() * 1000),
  );
  for (const num of numbers) {
    let insertPos = 0;
    for (let i = 0; i < chain.size(); i++) {
      if (chain.getAt(i) > num) break;
      insertPos = i + 1;
    }
    chain.insertAt(num, insertPos);
  }
});

// ========== 与原生数组对比 ==========
benchmarkSync("对比：Array.push (100 次)", 5000, ROUNDS, () => {
  const arr = [];
  for (let i = 0; i < SMALL_SIZE; i++) arr.push(i);
});

benchmarkSync("对比：Chain.append (100 次)", 5000, ROUNDS, () => {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) chain.append(i);
});

benchmarkSync("对比：Array.unshift (100 次)", 5000, ROUNDS, () => {
  const arr = [];
  for (let i = 0; i < SMALL_SIZE; i++) arr.unshift(i);
});

benchmarkSync("对比：Chain.prepend (100 次)", 5000, ROUNDS, () => {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) chain.prepend(i);
});

benchmarkSync("对比：Array 中间插入 (100 次)", 5000, ROUNDS, () => {
  const arr = [];
  for (let i = 0; i < SMALL_SIZE; i++) arr.push(i);
  for (let i = 0; i < 50; i++) arr.splice(Math.floor(arr.length / 2), 0, i);
});

benchmarkSync("对比：Chain 中间插入 (100 次)", 1000, ROUNDS, () => {
  const chain = createFilledChain(SMALL_SIZE);
  for (let i = 0; i < 50; i++) chain.insertAt(i, Math.floor(chain.size() / 2));
});

benchmarkSync("对比：Array 随机访问 (1000 次)", 5000, ROUNDS, () => {
  const arr = Array.from({ length: MEDIUM_SIZE }, (_, i) => i);
  for (let i = 0; i < MEDIUM_SIZE; i++) {
    const _ = arr[Math.floor(Math.random() * arr.length)];
  }
});

benchmarkSync("对比：Chain 随机访问 (1000 次)", 1000, ROUNDS, () => {
  const chain = createFilledChain(MEDIUM_SIZE);
  for (let i = 0; i < MEDIUM_SIZE; i++)
    chain.getAt(Math.floor(Math.random() * chain.size()));
});

printFooter();
