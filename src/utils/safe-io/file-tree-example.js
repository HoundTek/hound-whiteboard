/**
 * 文件树模块使用示例（主进程）
 * 
 * 演示文件树模块的各种柯里化 API 使用方法
 * 
 * @file file-tree-example.js
 */

import {
  DataPath,
  BaseDir,
  Dir,
  File,
  cd,
  father,
  exist,
  make,
  rm,
  cp,
  cat,
  write,
  ls,
  lsFile,
  zip,
  unzip,
  getPath,
} from "./safe-io/file-tree.js";

import { Option } from "./functional.js";

// ==================== 1. 获取数据目录 ====================

console.log("=== 1. 获取应用程序数据目录 ===");

const dataDir = DataPath();
console.log("数据目录:", getPath(dataDir).unwrapOr("获取失败"));

// ==================== 2. 基础路径操作 ====================

console.log("\n=== 2. 路径导航操作 ===");

let current = dataDir;

// 创建测试目录结构
current = cd(current)("test-folder");
make(current);

current = cd(current)("sub-dir");
make(current);

console.log("当前路径:", getPath(current).unwrap());

// 返回上一级
const parentDir = father(current);
console.log("父目录:", getPath(parentDir).unwrapOr("无父目录"));

// ==================== 3. 文件读写操作 ====================

console.log("\n=== 3. 文件读写操作 ===");

// 构造一个文件对象
const testFile = File(current)(Option({ name: "demo", ext: "txt" }));

// 写入文件
const writeResult = write(testFile)("这是通过 file-tree 模块写入的内容！\n当前时间: " + new Date().toISOString());
console.log("写入文件结果:", writeResult.isSome() ? "成功" : "失败");

// 读取文件内容
const content = cat(testFile);
console.log("文件内容:\n", content.unwrapOr("读取失败"));

// ==================== 4. 文件系统操作 ====================

console.log("\n=== 4. 文件系统操作 ===");

const anotherDir = cd(dataDir)("another-folder");
make(anotherDir);

// 复制目录
const copyResult = cp(current)(anotherDir);
console.log("复制目录结果:", copyResult.isSome() ? "成功" : "失败");

// 删除目录
const rmResult = rm(anotherDir);
console.log("删除目录结果:", rmResult.isSome() ? "成功" : "失败");

// 判断是否存在
console.log("test-folder 是否存在?", exist(cd(dataDir)("test-folder")).unwrapOr(false));

// ==================== 5. 列出目录内容 ====================

console.log("\n=== 5. 列出目录内容 ===");

const listResult = ls(dataDir)({ showHidden: false, filesOnly: false });
if (listResult.isSome()) {
  console.log("目录内容:");
  listResult.unwrap().forEach(item => {
    console.log(` - [${item.type}] ${item.name}${item.ext ? '.' + item.ext : ''}`);
  });
}

// 只列出文件
const filesOnly = lsFile(dataDir)();
console.log("\n仅文件数量:", filesOnly.unwrapOr([]).length);

// ==================== 6. 压缩与解压 ====================

console.log("\n=== 6. 压缩与解压操作 ===");

const zipFilePath = path.join(getPath(dataDir).unwrap(), "test-backup.zip");

// 压缩目录
const zipResult = zip(current)(zipFilePath);
console.log("压缩结果:", zipResult.isSome() ? "成功" : "失败");

// 解压到新目录
const extractDir = cd(dataDir)("extracted");
make(extractDir);

const unzipResult = unzip(zipFilePath)(extractDir);
console.log("解压结果:", unzipResult.isSome() ? "成功" : "失败");

console.log("\n=== 示例执行完成 ===");