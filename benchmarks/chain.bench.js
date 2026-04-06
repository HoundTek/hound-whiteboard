/**
 * @file Chain 性能测试
 * @module benchmarks/chain
 */

import Benchmark from "benchmark";
import { Chain } from "../src/utils/chain.js";

const suite = new Benchmark.Suite("Chain Benchmarks");

// 测试数据准备
const SMALL_SIZE = 100;
const MEDIUM_SIZE = 1000;
const LARGE_SIZE = 10000;

// 辅助函数：创建预填充的链表
function createFilledChain(size) {
  const chain = new Chain();
  for (let i = 0; i < size; i++) {
    chain.append(i);
  }
  return chain;
}

// ========== Append 操作测试 ==========
suite.add("Chain#append (单个元素)", function () {
  const chain = new Chain();
  chain.append(1);
});

suite.add("Chain#append (100 个元素)", function () {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) {
    chain.append(i);
  }
});

suite.add("Chain#append (1000 个元素)", function () {
  const chain = new Chain();
  for (let i = 0; i < MEDIUM_SIZE; i++) {
    chain.append(i);
  }
});

// ========== Prepend 操作测试 ==========
suite.add("Chain#prepend (单个元素)", function () {
  const chain = new Chain();
  chain.prepend(1);
});

suite.add("Chain#prepend (100 个元素)", function () {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) {
    chain.prepend(i);
  }
});

suite.add("Chain#prepend (1000 个元素)", function () {
  const chain = new Chain();
  for (let i = 0; i < MEDIUM_SIZE; i++) {
    chain.prepend(i);
  }
});

// ========== InsertAt 操作测试 ==========
suite.add("Chain#insertAt (开头位置，100 次)", function () {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) {
    chain.insertAt(i, 0);
  }
});

suite.add("Chain#insertAt (中间位置，100 次)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  for (let i = 0; i < 50; i++) {
    chain.insertAt(i, Math.floor(chain.size() / 2));
  }
});

suite.add("Chain#insertAt (末尾位置，100 次)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  for (let i = 0; i < SMALL_SIZE; i++) {
    chain.insertAt(i, chain.size());
  }
});

// ========== RemoveAt 操作测试 ==========
suite.add("Chain#removeAt (开头位置，100 次)", function () {
  const chain = createFilledChain(200);
  for (let i = 0; i < SMALL_SIZE; i++) {
    chain.removeAt(0);
  }
});

suite.add("Chain#removeAt (中间位置，50 次)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  for (let i = 0; i < 50; i++) {
    if (chain.size() > 0) {
      chain.removeAt(Math.floor(chain.size() / 2));
    }
  }
});

suite.add("Chain#removeAt (末尾位置，100 次)", function () {
  const chain = createFilledChain(200);
  for (let i = 0; i < SMALL_SIZE; i++) {
    chain.removeAt(chain.size() - 1);
  }
});

// ========== GetAt 操作测试 ==========
suite.add("Chain#getAt (100 元素链表，首元素)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.getAt(0);
});

suite.add("Chain#getAt (100 元素链表，中间元素)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.getAt(50);
});

suite.add("Chain#getAt (100 元素链表，末尾元素)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.getAt(99);
});

suite.add("Chain#getAt (1000 元素链表，中间元素)", function () {
  const chain = createFilledChain(MEDIUM_SIZE);
  chain.getAt(500);
});

// ========== IndexOf 操作测试 ==========
suite.add("Chain#indexOf (100 元素，查找首元素)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.indexOf(0);
});

suite.add("Chain#indexOf (100 元素，查找中间元素)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.indexOf(50);
});

suite.add("Chain#indexOf (100 元素，查找末尾元素)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.indexOf(99);
});

suite.add("Chain#indexOf (100 元素，查找不存在元素)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.indexOf(-1);
});

suite.add("Chain#indexOf (1000 元素，查找中间元素)", function () {
  const chain = createFilledChain(MEDIUM_SIZE);
  chain.indexOf(500);
});

// ========== Size & IsEmpty 操作测试 ==========
suite.add("Chain#size (100 元素链表)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.size();
});

suite.add("Chain#size (10000 元素链表)", function () {
  const chain = createFilledChain(LARGE_SIZE);
  chain.size();
});

suite.add("Chain#isEmpty (空链表)", function () {
  const chain = new Chain();
  chain.isEmpty();
});

suite.add("Chain#isEmpty (非空链表)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.isEmpty();
});

// ========== Clear 操作测试 ==========
suite.add("Chain#clear (100 元素链表)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  chain.clear();
});

suite.add("Chain#clear (10000 元素链表)", function () {
  const chain = createFilledChain(LARGE_SIZE);
  chain.clear();
});

// ========== 实际应用场景测试 ==========
suite.add("场景：构建链表并遍历 (500 节点)", function () {
  const chain = new Chain();

  // 构建链表
  for (let i = 0; i < 500; i++) {
    chain.append(i);
  }

  // 遍历所有节点
  for (let i = 0; i < chain.size(); i++) {
    chain.getAt(i);
  }
});

suite.add("场景：LRU 缓存模拟 (200 次操作)", function () {
  const chain = new Chain();
  const maxSize = 100;

  for (let i = 0; i < 200; i++) {
    // 查找是否存在
    const index = chain.indexOf(i % 50);

    if (index !== -1) {
      // 移到末尾（最近使用）
      const value = chain.removeAt(index);
      chain.append(value);
    } else {
      // 添加新元素
      if (chain.size() >= maxSize) {
        chain.removeAt(0); // 删除最久未使用
      }
      chain.append(i % 50);
    }
  }
});

suite.add("场景：链表反转 (200 个元素)", function () {
  const chain = createFilledChain(200);
  const reversed = new Chain();

  while (!chain.isEmpty()) {
    reversed.prepend(chain.removeAt(0));
  }
});

suite.add("场景：有序插入 (100 个随机数)", function () {
  const chain = new Chain();
  const numbers = Array.from({ length: 100 }, () =>
    Math.floor(Math.random() * 1000)
  );

  for (const num of numbers) {
    // 找到插入位置
    let insertPos = 0;
    for (let i = 0; i < chain.size(); i++) {
      if (chain.getAt(i) > num) {
        break;
      }
      insertPos = i + 1;
    }
    chain.insertAt(num, insertPos);
  }
});

// ========== 与原生数组对比 ==========
suite.add("对比：Array.push (100 次)", function () {
  const arr = [];
  for (let i = 0; i < SMALL_SIZE; i++) {
    arr.push(i);
  }
});

suite.add("对比：Chain.append (100 次)", function () {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) {
    chain.append(i);
  }
});

suite.add("对比：Array.unshift (100 次)", function () {
  const arr = [];
  for (let i = 0; i < SMALL_SIZE; i++) {
    arr.unshift(i);
  }
});

suite.add("对比：Chain.prepend (100 次)", function () {
  const chain = new Chain();
  for (let i = 0; i < SMALL_SIZE; i++) {
    chain.prepend(i);
  }
});

suite.add("对比：Array 中间插入 (100 次)", function () {
  const arr = [];
  for (let i = 0; i < SMALL_SIZE; i++) {
    arr.push(i);
  }
  for (let i = 0; i < 50; i++) {
    arr.splice(Math.floor(arr.length / 2), 0, i);
  }
});

suite.add("对比：Chain 中间插入 (100 次)", function () {
  const chain = createFilledChain(SMALL_SIZE);
  for (let i = 0; i < 50; i++) {
    chain.insertAt(i, Math.floor(chain.size() / 2));
  }
});

suite.add("对比：Array 随机访问 (1000 次)", function () {
  const arr = Array.from({ length: MEDIUM_SIZE }, (_, i) => i);
  for (let i = 0; i < MEDIUM_SIZE; i++) {
    const val = arr[Math.floor(Math.random() * arr.length)];
  }
});

suite.add("对比：Chain 随机访问 (1000 次)", function () {
  const chain = createFilledChain(MEDIUM_SIZE);
  for (let i = 0; i < MEDIUM_SIZE; i++) {
    chain.getAt(Math.floor(Math.random() * chain.size()));
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
console.log("开始 Chain 性能测试...\n");
console.log("═══════════════════════════════════════════════════");
suite.run({ async: true });
