/**
 * @file I/O 操作模块
 * @module io
 * @description 功能：
 * - 随机数文件池
 * - 封装了文件类与目录类
 * @author Zhou Chenyu & Frank Steven
 * @example
 * import { Directory, File, FilenameRandomPool } from "./io.js";
 */

import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";
import hidefile from "hidefile";

/**
 * 将路径拆分为各个段
 * @param {string} targetPath - 目标路径
 * @returns {string[]} 路径段数组
 * @example
 * splitPathSegments("/tmp/demo/file.txt");
 * // ["/", "tmp", "demo", "file.txt"]
 */
function splitPathSegments(targetPath) {
  const resolvedPath = path.normalize(path.resolve(targetPath));
  const { root } = path.parse(resolvedPath);
  const relativePath = resolvedPath.slice(root.length);
  const segments = relativePath.split(path.sep).filter(Boolean);
  return root ? [root, ...segments] : segments;
}

/**
 * 将路径段数组组合为完整路径
 * @param {string[]} segments - 路径段数组
 * @returns {string} 组合后的完整路径
 * @example
 * joinPathSegments(["/", "tmp", "demo"]);
 * // "/tmp/demo"
 */
function joinPathSegments(segments) {
  if (segments.length === 0) return "";
  const [root, ...rest] = segments;
  if (rest.length === 0) return root;
  return path.join(root, ...rest);
}

/**
 * 获取指定目录中的条目
 * @param {Directory} dir - 目录实例
 * @returns {fs.Dirent[]} 目录条目数组
 * @example
 * const dir = Directory.parse("/tmp/demo");
 * const entries = getDirectoryEntries(dir);
 * console.log(entries.map((entry) => entry.name));
 */
function getDirectoryEntries(dir) {
  return fs.readdirSync(dir.getPath(), { withFileTypes: true });
}

/**
 * 创建文件实例
 * @param {Directory} dir - 目录实例
 * @param {string} entryName - 文件名
 * @returns {File} 文件实例
 * @example
 * const dir = Directory.parse("/tmp/demo");
 * const file = getFileFromEntry(dir, "note.txt");
 * console.log(file.name, file.extension);
 */
function getFileFromEntry(dir, entryName) {
  const parsed = path.parse(entryName);
  return new File(dir, parsed.name, parsed.ext.substring(1));
}

/**
 * 获取指定目录中已占用的数字
 * @param {Directory} dir - 目录实例
 * @param {string} type - 类型 ("Directory" 或文件扩展名)
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number[]} 已占用的数字数组
 * @example
 * const dir = Directory.parse("/tmp/demo");
 * const numbers = getOccupiedNumbers(dir, "txt", 1, 100);
 * console.log(numbers);
 */
function getOccupiedNumbers(dir, type, min, max) {
  return getDirectoryEntries(dir)
    .filter((entry) => {
      if (type === "Directory") return entry.isDirectory();
      return entry.isFile() && path.parse(entry.name).ext.substring(1) === type;
    })
    .map((entry) => {
      if (type === "Directory") return entry.name;
      return path.parse(entry.name).name;
    })
    .map((name) => Number.parseInt(name, 10))
    .filter((value) => Number.isInteger(value) && min <= value && value <= max);
}

/**
 * 目录类
 * @class
 * @example
 * const dir = new Directory("/tmp", "demo");
 * console.log(dir.getPath());
 */
class Directory {
  /**
   * 目录路径分段数组
   * @type {Array<string>}
   * @description 目录路径被分割成的数组，每个元素是路径的一部分。
   * @example
   * const dir = new Directory("/tmp/demo");
   * console.log(dir.paths);
   */
  paths = [];

  /**
   * 创建目录实例
   * @param {string|Array<string>} address - 目录所在路径或路径段数组
   * @param {string} [name] - 目录名称
   * @example
   * new Directory("/path/to", "mydir"); // 创建一个路径为 "/path/to/mydir" 的目录实例
   * new Directory("/path/to/mydir"); // 创建一个路径为 "/path/to/mydir" 的目录实例
   * new Directory(["/", "path", "to", "mydir"]); // 创建一个路径为 "/path/to/mydir" 的目录实例
   */
  constructor(address, name) {
    if (Array.isArray(address)) {
      this.paths = [...address];
      return;
    }
    const dirPath = name === undefined ? address : path.join(address, name);
    this.paths = splitPathSegments(dirPath);
  }

  /**
   * 获取目录所在路径
   * @returns {string} 目录所在路径
   * @example
   * const dir = new Directory("/path/to/mydir");
   * console.log(dir.address); // "/path/to"
   */
  get address() {
    return path.dirname(this.getPath());
  }

  /**
   * 设置目录所在路径
   * @param {string} address - 新的目录所在路径
   * @example
   * const dir = new Directory("/tmp/demo");
   * dir.address = "/var";
   * console.log(dir.getPath()); // "/var/demo"
   */
  set address(address) {
    this.paths = splitPathSegments(path.join(address, this.name));
  }

  /**
   * 获取目录名称
   * @returns {string} 目录名称
   * @example
   * const dir = new Directory("/path/to/mydir");
   * console.log(dir.name); // "mydir"
   */
  get name() {
    return path.basename(this.getPath());
  }

  /**
   * 设置目录名称
   * @param {string} name - 新的目录名称
   * @example
   * const dir = new Directory("/tmp/demo");
   * dir.name = "assets";
   * console.log(dir.getPath()); // "/tmp/assets"
   */
  set name(name) {
    this.paths = splitPathSegments(path.join(this.address, name));
  }

  /**
   * 获取目录的完整绝对路径
   * @returns {string} 组合后的完整路径
   * @example
   * const dir = new Directory("/path/to/mydir");
   * console.log(dir.getPath()); // "/path/to/mydir"
   */
  getPath() {
    return joinPathSegments(this.paths);
  }

  /**
   * 进入指定子目录并返回新实例
   * @param {string} pathStr - 子目录路径(相对路径或目录名)
   * @returns {Directory} 新的目录实例
   * @description 该方法不会检查子目录是否存在，仅返回一个新的目录实例。
   * @example
   * const dir = new Directory("/tmp/demo");
   * const child = dir.cd("pages");
   * console.log(child.getPath()); // "/tmp/demo/pages"
   */
  cd(pathStr) {
    return new Directory(this.getPath(), pathStr);
  }

  /**
   * 获取当前目录的父目录实例
   * @returns {Directory} 父目录实例，如果是根目录则返回null
   * @example
   * const dir = new Directory("/tmp/demo/pages");
   * console.log(dir.father().getPath()); // "/tmp/demo"
   */
  father() {
    return Directory.parse(path.dirname(this.getPath()));
  }

  /**
   * 创建并返回指定文件的实例
   * @param {string} fileName - 文件名(不含扩展名)
   * @param {string} fileExt - 文件扩展名(不含点)
   * @returns {File} 文件实例
   * @example
   * const dir = new Directory("/tmp/demo");
   * const file = dir.peek("note", "txt");
   * console.log(file.getPath()); // "/tmp/demo/note.txt"
   */
  peek(fileName, fileExt) {
    return new File(this, fileName, fileExt);
  }

  /**
   * 检查指定子目录是否存在
   * @param {string} dirName - 子目录名称
   * @returns {boolean} 子目录是否存在
   * @example
   * const dir = new Directory("/tmp/demo");
   * console.log(dir.existDir("pages"));
   */
  existDir(dirName) {
    return this.cd(dirName).exist();
  }

  /**
   * 检查指定文件是否存在
   * @param {string} fileName - 文件名(不含扩展名)
   * @param {string} fileExt - 文件扩展名(不含点)
   * @returns {boolean} 文件是否存在
   * @example
   * const dir = new Directory("/tmp/demo");
   * console.log(dir.existFile("note", "txt"));
   */
  existFile(fileName, fileExt) {
    return this.peek(fileName, fileExt).exist();
  }

  /**
   * 检查当前目录是否存在
   * @returns {boolean} 目录是否存在
   * @example
   * const dir = new Directory("/tmp/demo");
   * console.log(dir.exist());
   */
  exist() {
    return fs.existsSync(this.getPath());
  }

  /**
   * 创建该目录
   * @returns {Directory} 当前目录对象
   * @example
   * const dir = new Directory("/tmp/demo");
   * dir.make();
   */
  make() {
    fs.mkdirSync(this.getPath(), { recursive: true });
    return this;
  }

  /**
   * 若该目录不存在则创建
   * @returns {Directory} 当前目录对象
   * @example
   * const dir = new Directory("/tmp/demo");
   * dir.existOrMake();
   */
  existOrMake() {
    if (!this.exist()) this.make();
    return this;
  }

  /**
   * 复制目录
   * @param {Directory} dest - 目标目录
   * @returns {Directory} 目标目录对象
   * @example
   * const source = new Directory("/tmp/demo");
   * const copied = source.cp(new Directory("/tmp/backup"));
   * console.log(copied.getPath());
   */
  cp(dest) {
    let ret;
    if (dest.exist()) {
      ret = dest.cd(this.name);
    } else {
      ret = dest;
    }
    fs.cpSync(this.getPath(), ret.getPath(), { recursive: true });
    return ret;
  }

  /**
   * 删除该目录
   * @returns {Directory} 当前目录对象
   * @example
   * const dir = new Directory("/tmp/demo");
   * dir.rm();
   */
  rm() {
    fs.rmSync(this.getPath(), { recursive: true, force: true });
    return this;
  }

  /**
   * 当目录存在时删除该目录
   * @returns {Directory} 当前目录对象
   * @example
   * const dir = new Directory("/tmp/demo");
   * dir.rmWhenExist();
   */
  rmWhenExist() {
    if (this.exist()) this.rm();
    return this;
  }

  /**
   * 移动目录
   * @param {Directory} dest - 目标目录
   * @returns {Directory} 目标目录对象
   * @example
   * const source = new Directory("/tmp/demo");
   * const moved = source.mv(new Directory("/tmp/archive"));
   * console.log(moved.getPath());
   */
  mv(dest) {
    const ret = dest.exist() ? dest.cd(this.name) : dest;
    fs.renameSync(this.getPath(), ret.getPath());
    return ret;
  }

  /**
   * 列出目录中的所有内容
   * @returns {Array<Directory|File>} 目录和文件数组
   * @example
   * const dir = new Directory("/tmp/demo");
   * console.log(dir.ls());
   */
  ls() {
    return fs.readdirSync(this.getPath());
  }

  /**
   * 列出目录中的所有子目录
   * @returns {Array<Directory>} 目录数组
   * @example
   * const dir = new Directory("/tmp/demo");
   * console.log(dir.lsDir().map((item) => item.getPath()));
   */
  lsDir() {
    return getDirectoryEntries(this)
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.cd(entry.name));
  }

  /**
   * 列出目录中的所有文件
   * @returns {Array<File>} 文件数组
   * @example
   * const dir = new Directory("/tmp/demo");
   * console.log(dir.lsFile().map((item) => item.getPath()));
   */
  lsFile() {
    return getDirectoryEntries(this)
      .filter((entry) => entry.isFile())
      .map((entry) => getFileFromEntry(this, entry.name));
  }

  /**
   * 隐藏目录
   * @returns {Directory} 当前目录对象
   * @example
   * const dir = new Directory("/tmp/demo");
   * dir.hide();
   */
  hide() {
    const tempDir = Directory.parse(hidefile.hideSync(this.getPath()));
    this.paths = [...tempDir.paths];
    return this;
  }

  /**
   * 取消隐藏目录
   * @returns {Directory} 当前目录对象
   * @example
   * const dir = new Directory("/tmp/.demo");
   * dir.unhide();
   */
  unhide() {
    const tempDir = Directory.parse(hidefile.revealSync(this.getPath()));
    this.paths = [...tempDir.paths];
    return this;
  }

  /**
   * 压缩目录
   * @param {File} file - 压缩后的文件
   * @param {boolean} remove - 是否删除原目录
   * @returns {File} 压缩后的文件对象
   * @example
   * const dir = new Directory("/tmp/demo");
   * const archive = new File(dir.father(), "demo", "zip");
   * dir.compress(archive);
   */
  compress(file, remove = false) {
    const zip = new AdmZip();
    zip.addLocalFolder(this.getPath());
    zip.writeZip(file.getPath());
    if (remove) {
      fs.rmSync(this.getPath(), { recursive: true, force: true });
    }
    return file;
  }

  /**
   * 获取隐藏后的目录结果
   * @param {Directory} dir - 目录对象
   * @returns {Directory} 隐藏后的目录对象
   * @example
   * const dir = new Directory("/tmp/demo");
   * console.log(Directory.getHideResult(dir).getPath()); // "/tmp/.demo"
   */
  static getHideResult(dir) {
    return new Directory(dir.address, "." + dir.name);
  }

  /**
   * 获取取消隐藏后的目录结果
   * @param {Directory} dir - 目录对象
   * @returns {Directory} 取消隐藏后的目录对象
   * @example
   * const dir = new Directory("/tmp/.demo");
   * console.log(Directory.getUnHideResult(dir).getPath()); // "/tmp/demo"
   */
  static getUnHideResult(dir) {
    return new Directory(dir.address, dir.name.substring(1));
  }

  /**
   * 解析路径字符串为目录对象
   * @param {string} pathStr - 路径字符串
   * @returns {Directory} 目录对象
   * @example
   * const dir = Directory.parse("/tmp/demo");
   * console.log(dir.paths);
   */
  static parse(pathStr) {
    return new Directory(splitPathSegments(pathStr));
  }
}

/**
 * @class
 * @property {Directory} dir - 文件所在目录
 * @property {string} name - 文件名 (不含扩展名)
 * @property {string} extension - 文件扩展名 (不含点)
 * @example
 * const file = new File("/tmp/demo", "note", "txt");
 * console.log(file.getPath());
 */
class File {
  dir = new Directory([]);
  name = "";
  extension = "";

  /**
   * 创建文件实例
   * @param {string|Directory} address - 文件所在路径或目录对象
   * @param {string} name - 文件名 (不含扩展名)
   * @param {string} extension - 文件扩展名 (不含点)
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * const other = new File(new Directory("/tmp/demo"), "data", "json");
   */
  constructor(address, name, extension = "") {
    this.dir =
      address instanceof Directory ? address : Directory.parse(address);
    this.name = name;
    this.extension = extension;
  }

  /**
   * 获取文件所在路径
   * @returns {string} 文件所在目录路径
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * console.log(file.address); // "/tmp/demo"
   */
  get address() {
    return this.dir.getPath();
  }

  /**
   * 设置文件所在路径
   * @param {string|Directory} address - 新的目录路径或目录对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * file.address = "/var/data";
   * console.log(file.getPath()); // "/var/data/note.txt"
   */
  set address(address) {
    this.dir =
      address instanceof Directory ? address : Directory.parse(address);
  }

  /**
   * 获取文件的完整绝对路径
   * @returns {string} 组合后的完整路径
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * console.log(file.getPath()); // "/tmp/demo/note.txt"
   */
  getPath() {
    if (this.extension === "") return path.join(this.dir.getPath(), this.name);
    return path.join(this.dir.getPath(), this.name + "." + this.extension);
  }

  /**
   * 获取文件所在的目录实例
   * @returns {Directory} 父目录实例
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * console.log(file.unPeek().getPath()); // "/tmp/demo"
   */
  unPeek() {
    return Directory.parse(this.dir.getPath());
  }

  /**
   * 读取文件内容为字符串
   * @returns {string} 文件内容字符串
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * console.log(file.cat());
   */
  cat() {
    return fs.readFileSync(this.getPath(), "utf8");
  }

  /**
   * 读取 JSON 文件内容
   * @returns {JSON} JSON 对象
   * @example
   * const file = new File("/tmp/demo", "config", "json");
   * console.log(file.catJSON());
   */
  catJSON() {
    return JSON.parse(this.cat());
  }

  /**
   * 写入字符串
   * @param {string} content - 要写入的内容
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * file.write("hello");
   */
  write(content) {
    fs.writeFileSync(this.getPath(), content, "utf8");
    return this;
  }

  /**
   * 写入 JSON
   * @param {JSON} content - 要写入的内容
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", "config", "json");
   * file.writeJSON({ ok: true });
   */
  writeJSON(content) {
    this.write(JSON.stringify(content, null, 2));
    return this;
  }

  /**
   * 判断该文件是否存在
   * @returns {boolean} 是否存在
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * console.log(file.exist());
   */
  exist() {
    return fs.existsSync(this.getPath());
  }

  /**
   * 将该文件置空
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * file.init();
   */
  init() {
    fs.writeFileSync(this.getPath(), "", "utf8");
    return this;
  }

  /**
   * 若该文件不存在则创建并将该文件置空
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * file.existOrInit();
   */
  existOrInit() {
    if (!this.exist()) this.init();
    return this;
  }

  /**
   * 若该文件不存在则创建并写入内容
   * @param {string} content - 要写入的内容
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * file.existOrWrite("hello");
   */
  existOrWrite(content) {
    if (!this.exist()) this.write(content);
    return this;
  }

  /**
   * 若该文件不存在则创建并写入 JSON
   * @param {Object} content - 要写入的内容
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", "config", "json");
   * file.existOrWriteJSON({ ok: true });
   */
  existOrWriteJSON(content) {
    if (!this.exist()) this.writeJSON(content);
    return this;
  }

  /**
   * 转换为 Url
   * @returns {string} URL 字符串
   * @example
   * const file = new File("/tmp/demo", "image", "png");
   * file.toUrl();
   */
  toUrl() {
    return (previewScreen.style.background = `url("${this.getPath().replace(/\\/g, "\\\\")}")`);
  }

  /**
   * 复制文件
   * @param {File|Directory} dest - 目标文件或目录
   * @returns {File} 目标文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * const copied = file.cp(new Directory("/tmp/backup"));
   * console.log(copied.getPath());
   */
  cp(dest) {
    let ret;
    if (dest instanceof File) {
      ret = dest;
    } else {
      ret = dest.peek(this.name, this.extension);
    }
    fs.copyFileSync(this.getPath(), ret.getPath());
    return ret;
  }

  /**
   * 移动文件
   * @param {File|Directory} dest - 目标文件或目录
   * @returns {File} 目标文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * const moved = file.mv(new Directory("/tmp/archive"));
   * console.log(moved.getPath());
   */
  mv(dest) {
    const ret =
      dest instanceof File ? dest : dest.peek(this.name, this.extension);
    fs.renameSync(this.getPath(), ret.getPath());
    return ret;
  }

  /**
   * 删除该文件
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * file.rm();
   */
  rm() {
    fs.unlinkSync(this.getPath());
    return this;
  }

  /**
   * 当该文件存在时删除该文件
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * file.rmWhenExist();
   */
  rmWhenExist() {
    if (this.exist()) this.rm();
    return this;
  }

  /**
   * 隐藏文件
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * file.hide();
   */
  hide() {
    const tempFile = File.parse(hidefile.hideSync(this.getPath()));
    this.dir = tempFile.dir;
    this.extension = tempFile.extension;
    this.name = tempFile.name;
    return this;
  }

  /**
   * 取消隐藏文件
   * @returns {File} 当前文件对象
   * @example
   * const file = new File("/tmp/demo", ".note", "txt");
   * file.unhide();
   */
  unhide() {
    const tempFile = File.parse(hidefile.revealSync(this.getPath()));
    this.dir = tempFile.dir;
    this.extension = tempFile.extension;
    this.name = tempFile.name;
    return this;
  }

  /**
   * 解压文件
   * @param {Directory} dir - 解压到的目录
   * @returns {Directory} 目标目录对象
   * @example
   * const archive = new File("/tmp/demo", "assets", "zip");
   * archive.extract(new Directory("/tmp/output"));
   */
  extract(dir) {
    const zip = new AdmZip(this.getPath());
    zip.extractAllTo(dir.getPath(), true);
    return dir;
  }

  /**
   * 获取隐藏后的文件结果
   * @param {File} file - 文件对象
   * @returns {File} 隐藏后的文件对象
   * @example
   * const file = new File("/tmp/demo", "note", "txt");
   * console.log(File.getHideResult(file).getPath()); // "/tmp/demo/.note.txt"
   */
  static getHideResult(file) {
    return new File(file.unPeek(), "." + file.name, file.extension);
  }

  /**
   * 获取取消隐藏后的文件结果
   * @param {File} file - 文件对象
   * @returns {File} 取消隐藏后的文件对象
   * @example
   * const file = new File("/tmp/demo", ".note", "txt");
   * console.log(File.getUnHideResult(file).getPath()); // "/tmp/demo/note.txt"
   */
  static getUnHideResult(file) {
    return new File(file.unPeek(), file.name.substring(1), file.extension);
  }

  /**
   * 解析路径字符串为文件对象
   * @param {string} pathStr - 路径字符串
   * @returns {File} 文件对象
   * @example
   * const file = File.parse("/tmp/demo/note.txt");
   * console.log(file.name, file.extension);
   */
  static parse(pathStr) {
    const pathRes = path.parse(pathStr);
    return new File(
      Directory.parse(pathRes.dir),
      pathRes.name,
      pathRes.ext.substring(1),
    );
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
   * @example
   * const pool = new FilenameRandomPool(new Directory("/tmp/demo"), "txt");
   */
  constructor(dir, type = "Directory") {
    this.dir = dir;
    this.type = type;
    const min = 1,
      max = 1145141919810;
    this.pool = new RandomNumberPool(min, max);
    const numbers = getOccupiedNumbers(dir, type, min, max);
    this.pool.initFromArray(numbers);
  }

  /**
   * 向随机池中添加指定 ID 的目录/文件
   * @param {string} ID - 要添加的 ID
   * @returns {boolean} 是否成功添加
   * @example
   * const pool = new FilenameRandomPool(new Directory("/tmp/demo"), "txt");
   * pool.add("12");
   */
  add(ID) {
    return this.pool.add(Number.parseInt(ID, 10));
  }

  /**
   * 查询指定 ID 是否在随机池中
   * @param {string} ID - 要查询的 ID
   * @returns {boolean} 是否存在
   * @example
   * const pool = new FilenameRandomPool(new Directory("/tmp/demo"), "txt");
   * console.log(pool.include("12"));
   */
  include(ID) {
    return this.pool.include(Number.parseInt(ID, 10));
  }

  /**
   * 查询该池是否已满
   * @returns {boolean} 是否已满
   * @example
   * const pool = new FilenameRandomPool(new Directory("/tmp/demo"), "txt");
   * console.log(pool.isFull());
   */
  isFull() {
    return this.pool.isFull();
  }

  /**
   * 生成不重复的随机目录/文件实例
   * @returns {Directory|File} 新创建的目录或文件实例
   * @throws {Error} 当随机池已被占满时
   * @example
   * const pool = new FilenameRandomPool(new Directory("/tmp/demo"), "txt");
   * const file = pool.generate();
   * console.log(file.getPath());
   */
  generate() {
    const name = this.pool.generate().toString();
    if (this.type === "Directory") {
      const newDir = new Directory(this.dir.getPath(), name);
      fs.mkdirSync(newDir.getPath(), { recursive: true });
      return newDir;
    } else {
      const newFile = new File(this.dir, name, this.type);
      fs.writeFileSync(newFile.getPath(), "", "utf8");
      return newFile;
    }
  }

  /**
   * 从随机池中删除指定 ID 的目录/文件
   * @param {string} ID - 目录/文件 ID
   * @returns {boolean} 是否成功删除
   * @example
   * const pool = new FilenameRandomPool(new Directory("/tmp/demo"), "txt");
   * pool.remove("12");
   */
  remove(ID) {
    if (this.type === "Directory") {
      this.dir.cd(ID).rm();
    } else {
      this.dir.peek(ID, this.type).rm();
    }
    return this.pool.remove(Number.parseInt(ID, 10));
  }

  /**
   * 在池中重新生成一个不重复的 ID 并重命名目录/文件
   * @param {string} ID - 要重命名的目录/文件 ID
   * @returns {Directory|File} 重命名后的文件或目录
   * @example
   * const pool = new FilenameRandomPool(new Directory("/tmp/demo"), "txt");
   * const renamed = pool.rename("12");
   * console.log(renamed.getPath());
   */
  rename(ID) {
    let newID = this.pool.rename(Number.parseInt(ID, 10)).toString();
    if (this.type === "Directory") {
      this.dir.cd(ID).mv(this.dir.cd(newID));
      return this.dir.cd(newID);
    } else {
      this.dir.peek(ID, this.type).mv(this.dir.peek(newID, this.type));
      return this.dir.peek(newID, this.type);
    }
  }
}

export { Directory, File, FilenameRandomPool };
