/**
 * @file I/O 操作模块
 * @module io
 * @description 功能：
 * - 随机数文件池
 * - 封装了文件类与目录类
 */

import path from "path";
import hidefile from "hidefile";
import * as fp from "./fp.js";

/**
 * @class
 * @property {string} address - 目录所在路径
 * @property {string} name - 目录名称
 */
class Directory {
  address = "";
  name = "";

  /**
   * 创建目录实例
   * @param {string} address - 目录所在路径
   * @param {string} name - 目录名称
   */
  constructor (address, name) {
    this.address = address;
    this.name = name;
  }

  /**
   * 获取目录的完整绝对路径
   * @returns {string} 组合后的完整路径
   */
  getPath() {
    return path.join(this.address, this.name);
  }

  /**
   * 进入指定子目录并返回新实例
   * @param {string} pathStr - 子目录路径(相对路径或目录名)
   * @returns {Directory} 新的目录实例
   */
  cd(pathStr) {
    return new Directory(this.getPath(), pathStr);
  }

  /**
   * 获取当前目录的父目录实例
   * @returns {Directory} 父目录实例，如果是根目录则返回null
   */
  father() {
    return new Directory(path.dirname(this.address), path.basename(this.address));
  }

  /**
   * 创建并返回指定文件的实例
   * @param {string} fileName - 文件名(不含扩展名)
   * @param {string} fileExt - 文件扩展名(不含点)
   * @returns {File} 文件实例
   */
  peek(fileName, fileExt) {
    return new File(this.getPath(), fileName, fileExt)
  }

  /**
   * 检查指定子目录是否存在
   * @param {string} dirName - 子目录名称
   * @returns {boolean} 子目录是否存在
   */
  existDir(dirName) {
    return fp.exist(this.cd(dirName));
  }

  /**
   * 检查指定文件是否存在
   * @param {string} fileName - 文件名(不含扩展名)
   * @param {string} fileExt - 文件扩展名(不含点)
   * @returns {boolean} 文件是否存在
   */
  existFile(fileName, fileExt) {
    return fp.exist(this.peek(fileName, fileExt));
  }

  /**
   * 检查当前目录是否存在
   * @returns {boolean} 目录是否存在
   */
  exist() {
    return fp.exist(this);
  }

  /**
   * 创建该目录
   * @returns {Directory} 当前目录对象
   */
  make() {
    fp.mkdir(this);
    return this;
  }

  /**
   * 若该目录不存在则创建
   * @returns {Directory} 当前目录对象
   */
  existOrMake() {
    if (!this.exist()) this.make();
    return this;
  }

  /**
   * 复制目录
   * @param {Directory} dest - 目标目录
   * @returns {Directory} 目标目录对象
   */
  cp(dest) {
    let ret;
    if (dest.exist()) {
      ret = dest.cd(this.name);
    } else {
      ret = dest;
    }
    fp.cpDir(this, ret);
    return ret;
  }

  /**
   * 删除该目录
   * @returns {Directory} 当前目录对象
   */
  rm() {
    fp.rmDir(this);
    return this;
  }

  /**
   * 当目录存在时删除该目录
   * @returns {Directory} 当前目录对象
   */
  rmWhenExist() {
    if (this.exist()) this.rm();
    return this;
  }

  /**
   * 移动目录
   * @param {Directory} dest - 目标目录
   * @returns {Directory} 目标目录对象
   */
  mv(dest) {
    this.cp(dest);
    this.rm();
    return dest;
  }

  /**
   * 列出目录中的所有内容
   * @returns {Array<Directory|File>} 目录和文件数组
   */
  ls() {
    return fp.ls(this);
  }

  /**
   * 列出目录中的所有子目录
   * @returns {Array<Directory>} 目录数组
   */
  lsDir() {
    return fp.lsDir(this);
  }

  /**
   * 列出目录中的所有文件
   * @returns {Array<File>} 文件数组
   */
  lsFile() {
    return fp.lsFile(this);
  }

  /**
   * 隐藏目录
   * @returns {Directory} 当前目录对象
   */
  hide() {
    const tempDir = Directory.parse(hidefile.hideSync(this.getPath()));
    this.address = tempDir.address;
    this.name = tempDir.name;
    return this;
  }

  /**
   * 取消隐藏目录
   * @returns {Directory} 当前目录对象
   */
  unhide() {
    const tempDir = Directory.parse(hidefile.revealSync(this.getPath()));
    this.address = tempDir.address;
    this.name = tempDir.name;
    return this;
  }

  /**
   * 压缩目录
   * @param {File} file - 压缩后的文件
   * @param {boolean} remove - 是否删除原目录
   * @returns {File} 压缩后的文件对象
   */
  compress(file, remove = false) {
    fp.compressFile(this, file, remove);
    return file;
  }

  /**
   * 获取隐藏后的目录结果
   * @param {Directory} dir - 目录对象
   * @returns {Directory} 隐藏后的目录对象
   */
  static getHideResult(dir) {
    return new Directory(dir.address, "." + dir.name);
  }

  /**
   * 获取取消隐藏后的目录结果
   * @param {Directory} dir - 目录对象
   * @returns {Directory} 取消隐藏后的目录对象
   */
  static getUnHideResult(dir) {
    return new Directory(dir.address, dir.name.substring(1));
  }

  /**
   * 解析路径字符串为目录对象
   * @param {string} pathStr - 路径字符串
   * @returns {Directory} 目录对象
   */
  static parse(pathStr) {
    return new Directory(path.dirname(pathStr), path.basename(pathStr));
  }
}

/**
 * @class
 * @property {string} address - 文件所在路径
 * @property {string} name - 文件名 (不含扩展名)
 * @property {string} extension - 文件扩展名 (不含点)
 */
class File {
  address = "";
  name = "";
  extension = "";

  /**
   * 创建文件实例
   * @param {string} address - 文件所在路径
   * @param {string} name - 文件名 (不含扩展名)
   * @param {string} extension - 文件扩展名 (不含点)
   */
  constructor (address, name, extension = "") {
    this.address = address;
    this.name = name;
    this.extension = extension;
  }

  /**
   * 获取文件的完整绝对路径
   * @returns {string} 组合后的完整路径
   */
  getPath() {
    if (this.extension === "") return path.join(this.address, this.name);
    return path.join(this.address, this.name + "." + this.extension);
  }

  /**
   * 获取文件所在的目录实例
   * @returns {Directory} 父目录实例
   */
  unPeek() {
    return new Directory(path.dirname(this.address), path.basename(this.address));
  }

  /**
   * 读取文件内容为字符串
   * @returns {string} 文件内容字符串
   */
  cat() {
    return fp.readFile(this);
  }

  /**
   * 读取 JSON 文件内容
   * @returns {JSON} JSON 对象
   */
  catJSON() {
    return JSON.parse(this.cat());
  }

  /**
   * 写入字符串
   * @param {string} content - 要写入的内容
   * @returns {File} 当前文件对象
   */
  write(content) {
    fp.writeFile(this, content);
    return this;
  }

  /**
   * 写入 JSON
   * @param {JSON} content - 要写入的内容
   * @returns {File} 当前文件对象
   */
  writeJSON(content) {
    this.write(JSON.stringify(content, null, 2));
    return this;
  }

  /**
   * 判断该文件是否存在
   * @returns {boolean} 是否存在
   */
  exist() {
    return fp.exist(this);
  }

  /**
   * 将该文件置空
   * @returns {File} 当前文件对象
   */
  init() {
    fp.touch(this);
    return this;
  }

  /**
   * 若该文件不存在则创建并将该文件置空
   * @returns {File} 当前文件对象
   */
  existOrInit() {
    if (!this.exist()) this.init();
    return this;
  }

  /**
   * 若该文件不存在则创建并写入内容
   * @param {string} content - 要写入的内容
   * @returns {File} 当前文件对象
   */
  existOrWrite(content) {
    if(!this.exist()) this.write(content);
    return this;
  }

  /**
   * 若该文件不存在则创建并写入 JSON
   * @param {Object} content - 要写入的内容
   * @returns {File} 当前文件对象
   */
  existOrWriteJSON(content) {
    if(!this.exist()) this.writeJSON(content);
    return this;
  }

  /**
   * 转换为 Url
   * @returns {string} URL 字符串
   */
  toUrl() {
    return previewScreen.style.background = `url("${this.getPath().replace(/\\/g, "\\\\")}")`;
  }

  /**
   * 复制文件
   * @param {File|Directory} dest - 目标文件或目录
   * @returns {File} 目标文件对象
   */
  cp(dest) {
    let ret;
    if (dest instanceof File) {
      ret = dest;
    } else {
      ret = dest.peek(this.name, this.extension);
    }
    fp.cp(this, ret);
    return ret;
  }

  /**
   * 移动文件
   * @param {File|Directory} dest - 目标文件或目录
   * @returns {File} 目标文件对象
   */
  mv(dest) {
    this.cp(dest);
    this.rm();
    return dest;
  }

  /**
   * 删除该文件
   * @returns {File} 当前文件对象
   */
  rm() {
    fp.rm(this);
    return this;
  }

  /**
   * 当该文件存在时删除该文件
   * @returns {File} 当前文件对象
   */
  rmWhenExist() {
    if (this.exist()) this.rm();
    return this;
  }

  /**
   * 隐藏文件
   * @returns {File} 当前文件对象
   */
  hide() {
    const tempFile = File.parse(hidefile.hideSync(this.getPath()));
    this.address = tempFile.address;
    this.extension = tempFile.extension;
    this.name = tempFile.name;
    return this;
  }

  /**
   * 取消隐藏文件
   * @returns {File} 当前文件对象
   */
  unhide() {
    const tempFile = File.parse(hidefile.revealSync(this.getPath()));
    this.address = tempFile.address;
    this.extension = tempFile.extension;
    this.name = tempFile.name;
    return this;
  }

  /**
   * 解压文件
   * @param {Directory} dir - 解压到的目录
   * @returns {Directory} 目标目录对象
   */
  extract(dir) {
    fp.extractFile(this, dir);
    return dir;
  }

  /**
   * 获取隐藏后的文件结果
   * @param {File} file - 文件对象
   * @returns {File} 隐藏后的文件对象
   */
  static getHideResult(file) {
    return new File(file.address, "." + file.name, file.extension);
  }

  /**
   * 获取取消隐藏后的文件结果
   * @param {File} file - 文件对象
   * @returns {File} 取消隐藏后的文件对象
   */
  static getUnHideResult(file) {
    return new File(file.address, file.name.substring(1), file.extension);
  }

  /**
   * 解析路径字符串为文件对象
   * @param {string} pathStr - 路径字符串
   * @returns {File} 文件对象
   */
  static parse(pathStr) {
    const pathRes = path.parse(pathStr);
    return new File(pathRes.dir, pathRes.name, pathRes.ext.substring(1));
  }
}

import { RandomNumberPool } from "../utils/algorithm.js";

/**
 * 不重复的随机文件名池
 * @class
 * @property {Directory} dir 目标目录实例
 * @property {string} type "Directory" 表示目录池，其他值表示文件扩展名
 * @property {RandomNumberPool} pool 内部随机数池
 * @example
 * let pool = new FilenameRandomPool(myDir, "txt");
 * let file1 = pool.generate(); // 创建一个随机命名的 .txt 文件
 * let file2 = pool.generate(); // 创建另一个不重复的 .txt 文件
 * pool.remove(file1.name); // 删除文件并从池中移除
 * let file3 = pool.rename(file2.name); // 重命名文件为新的随机名称
 */
class FilenameRandomPool {
  /**
   * 创建随机文件名池实例
   * @param {Directory} dir 目标目录实例
   * @param {string} type "Directory"表示目录池，其他值表示文件扩展名
   */
  constructor(dir, type = "Directory") {
    this.dir = dir;
    this.type = type;
    const min = 1, max = 1145141919810;
    this.pool = new RandomNumberPool(min, max);
    const numbers = fp.lsDir(dir)
                      .map(parseInt)
                      .filter(t => min <= t && t <= max);
    this.pool.initFromArray(numbers);
  }

  /**
   * 向随机池中添加指定 ID 的目录/文件
   * @param {string} ID - 要添加的 ID
   * @returns {boolean} 是否成功添加
   */
  add(ID) {
    return this.pool.add(parseInt(ID));
  }

  /**
   * 查询指定 ID 是否在随机池中
   * @param {string} ID - 要查询的 ID
   * @returns {boolean} 是否存在
   */
  include(ID) {
    return this.pool.include(parseInt(ID));
  }

  /**
   * 查询该池是否已满
   * @returns {boolean} 是否已满
   */
  isFull() {
    return this.pool.isFull();
  }

  /**
   * 生成不重复的随机目录/文件实例
   * @returns {Directory|File} 新创建的目录或文件实例
   * @throws {Error} 当随机池已被占满时
   */
  generate() {
    const name = this.pool.generate().toString();
    if (this.type === "Directory") {
      const newDir = new Directory(this.dir.getPath(), name);
      fp.mkdir(newDir);
      return newDir;
    } else {
      const newFile = new File(this.dir.getPath(), name, this.type);
      fp.touch(newFile);
      return newFile;
    }
  }

  /**
   * 从随机池中删除指定 ID 的目录/文件
   * @param {string} ID - 目录/文件 ID
   * @returns {boolean} 是否成功删除
   */
  remove(ID) {
    if (this.type === "Directory") {
      this.dir.cd(ID).rm();
    } else {
      this.dir.peek(ID, this.type).rm();
    }
    return this.pool.remove(parseInt(ID));
  }

  /**
   * 在池中重新生成一个不重复的 ID 并重命名目录/文件
   * @param {string} ID - 要重命名的目录/文件 ID
   * @returns {Directory|File} 重命名后的文件或目录
   */
  rename(ID) {
    let newID = this.pool.rename(parseInt(ID)).toString();
    if (this.type === "Directory") {
      this.dir.cd(ID).mv(this.dir.cd(newID));
      return this.dir.cd(newID);
    } else {
      this.dir.peek(ID, this.type).mv(this.dir.peek(newID, this.type));
      return this.dir.peek(newID, this.type);
    }
  }
}

export {
  Directory,
  File,
  FilenameRandomPool,
};
