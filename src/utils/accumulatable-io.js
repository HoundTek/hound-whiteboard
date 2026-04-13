/**
 * @file 可积压 I/O 代理模块
 * @module accumulatable-io
 * @description 功能：
 * - 为渲染进程提供可积压的 Directory 与 File 代理类
 * - 将多次 I/O 调用积压后统一通过 IPC 批量提交
 */

function splitPathSegments(targetPath) {
  if (!targetPath) return [];

  if (/^[A-Za-z]:[\\/]/.test(targetPath)) {
    const normalizedPath = targetPath.replace(/\//g, "\\");
    const root = normalizedPath.slice(0, 3);
    const relativePath = normalizedPath.slice(3);
    const segments = relativePath.split("\\").filter(Boolean);
    return [root, ...segments];
  }

  const normalizedPath = targetPath.replace(/\\/g, "/");
  if (normalizedPath.startsWith("/")) {
    return ["/", ...normalizedPath.slice(1).split("/").filter(Boolean)];
  }

  return normalizedPath.split("/").filter(Boolean);
}

function joinPathSegments(segments) {
  if (segments.length === 0) return "";

  const [root, ...rest] = segments;
  if (rest.length === 0) return root;

  const separator = root.includes("\\") ? "\\" : "/";
  if (root.endsWith("/") || root.endsWith("\\")) {
    return root + rest.join(separator);
  }
  return root + separator + rest.join(separator);
}

function parseFileEntryName(entryName) {
  const lastDotIndex = entryName.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return { name: entryName, extension: "" };
  }

  return {
    name: entryName.slice(0, lastDotIndex),
    extension: entryName.slice(lastDotIndex + 1),
  };
}

function getBridge() {
  const bridge = globalThis.__houndIOBridge;
  if (!bridge || typeof bridge.callBatch !== "function") {
    throw new Error(
      "Accumultable io bridge is unavailable. Did preload-io.js load?",
    );
  }
  return bridge;
}

function isDirectoryLike(value) {
  return value instanceof Directory;
}

function isFileLike(value) {
  return value instanceof File;
}

function serializeIOValue(value) {
  if (isDirectoryLike(value)) {
    return {
      __houndType: "Directory",
      paths: [...value.paths],
    };
  }

  if (isFileLike(value)) {
    return {
      __houndType: "File",
      dir: serializeIOValue(value.dir),
      name: value.name,
      extension: value.extension,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeIOValue(item));
  }

  return value;
}

function deserializeIOValue(value) {
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => deserializeIOValue(item));
  }

  if (value.__houndType === "Directory") {
    return new Directory(value.paths);
  }

  if (value.__houndType === "File") {
    return new File(
      deserializeIOValue(value.dir),
      value.name,
      value.extension,
    );
  }

  return value;
}

class AccumulatableIOBase {
  pendingOperations = [];

  enqueue(method, args = []) {
    this.pendingOperations.push({ method, args });
    return this;
  }

  updateFromSerializedTarget(serializedTarget) {
    const updatedTarget = deserializeIOValue(serializedTarget);
    this.applyTargetState(updatedTarget);
  }

  async flushAll() {
    return this.flush(this.pendingOperations.length);
  }

  async flush(count = 1) {
    const size = Math.max(0, Math.min(count, this.pendingOperations.length));
    if (size === 0) return [];

    const operations = this.pendingOperations.splice(0, size).map((operation) => ({
      method: operation.method,
      args: serializeIOValue(operation.args),
    }));

    const response = await getBridge().callBatch({
      target: serializeIOValue(this),
      operations,
    });

    this.updateFromSerializedTarget(response.target);
    return deserializeIOValue(response.results);
  }
}

/**
 * 可积压目录代理。
 * @class
 */
class Directory extends AccumulatableIOBase {
  paths = [];

  constructor(address, name) {
    super();
    if (Array.isArray(address)) {
      this.paths = [...address];
      return;
    }
    const dirPath =
      name === undefined
        ? address
        : joinPathSegments([...splitPathSegments(address), name]);
    this.paths = splitPathSegments(dirPath);
  }

  get address() {
    if (this.paths.length <= 1) return this.paths[0] ?? "";
    return joinPathSegments(this.paths.slice(0, -1));
  }

  set address(address) {
    this.paths = [...splitPathSegments(address), this.name];
  }

  get name() {
    if (this.paths.length <= 1) return "";
    return this.paths[this.paths.length - 1];
  }

  set name(name) {
    this.paths = [...this.paths.slice(0, -1), name];
  }

  applyTargetState(target) {
    this.paths = [...target.paths];
  }

  getPath() {
    return joinPathSegments(this.paths);
  }

  cd(pathStr) {
    return new Directory([
      ...this.paths,
      ...splitPathSegments(pathStr).filter(
        (segment, index) =>
          !(index === 0 && (segment === "/" || segment.endsWith(":\\"))),
      ),
    ]);
  }

  father() {
    return new Directory(this.paths.slice(0, -1));
  }

  peek(fileName, fileExt) {
    return new File(this, fileName, fileExt);
  }

  existDir(dirName) {
    return this.enqueue("existDir", [dirName]);
  }

  existFile(fileName, fileExt) {
    return this.enqueue("existFile", [fileName, fileExt]);
  }

  exist() {
    return this.enqueue("exist");
  }

  make() {
    return this.enqueue("make");
  }

  existOrMake() {
    return this.enqueue("existOrMake");
  }

  cp(dest) {
    return this.enqueue("cp", [dest]);
  }

  rm() {
    return this.enqueue("rm");
  }

  rmWhenExist() {
    return this.enqueue("rmWhenExist");
  }

  mv(dest) {
    return this.enqueue("mv", [dest]);
  }

  ls() {
    return this.enqueue("ls");
  }

  lsDir() {
    return this.enqueue("lsDir");
  }

  lsFile() {
    return this.enqueue("lsFile");
  }

  hide() {
    return this.enqueue("hide");
  }

  unhide() {
    return this.enqueue("unhide");
  }

  compress(file, remove = false) {
    return this.enqueue("compress", [file, remove]);
  }

  static getHideResult(dir) {
    return new Directory(dir.address, "." + dir.name);
  }

  static getUnHideResult(dir) {
    return new Directory(dir.address, dir.name.substring(1));
  }

  static parse(pathStr) {
    return new Directory(splitPathSegments(pathStr));
  }
}

/**
 * 可积压文件代理。
 * @class
 */
class File extends AccumulatableIOBase {
  dir = new Directory([]);
  name = "";
  extension = "";

  constructor(address, name, extension = "") {
    super();
    this.dir = address instanceof Directory ? address : Directory.parse(address);
    this.name = name;
    this.extension = extension;
  }

  get address() {
    return this.dir.getPath();
  }

  set address(address) {
    this.dir = address instanceof Directory ? address : Directory.parse(address);
  }

  applyTargetState(target) {
    this.dir = target.dir;
    this.name = target.name;
    this.extension = target.extension;
  }

  getPath() {
    const filename =
      this.extension === "" ? this.name : `${this.name}.${this.extension}`;
    return joinPathSegments([...this.dir.paths, filename]);
  }

  unPeek() {
    return new Directory([...this.dir.paths]);
  }

  cat() {
    return this.enqueue("cat");
  }

  catJSON() {
    return this.enqueue("catJSON");
  }

  write(content) {
    return this.enqueue("write", [content]);
  }

  writeJSON(content) {
    return this.enqueue("writeJSON", [content]);
  }

  exist() {
    return this.enqueue("exist");
  }

  init() {
    return this.enqueue("init");
  }

  existOrInit() {
    return this.enqueue("existOrInit");
  }

  existOrWrite(content) {
    return this.enqueue("existOrWrite", [content]);
  }

  existOrWriteJSON(content) {
    return this.enqueue("existOrWriteJSON", [content]);
  }

  toUrl() {
    return (previewScreen.style.background = `url("${this.getPath().replace(/\\/g, "\\\\")}")`);
  }

  cp(dest) {
    return this.enqueue("cp", [dest]);
  }

  mv(dest) {
    return this.enqueue("mv", [dest]);
  }

  rm() {
    return this.enqueue("rm");
  }

  rmWhenExist() {
    return this.enqueue("rmWhenExist");
  }

  hide() {
    return this.enqueue("hide");
  }

  unhide() {
    return this.enqueue("unhide");
  }

  extract(dir) {
    return this.enqueue("extract", [dir]);
  }

  static getHideResult(file) {
    return new File(file.unPeek(), "." + file.name, file.extension);
  }

  static getUnHideResult(file) {
    return new File(file.unPeek(), file.name.substring(1), file.extension);
  }

  static parse(pathStr) {
    const normalizedPath = pathStr.replace(/\\/g, "/");
    const segments = splitPathSegments(pathStr);
    const entryName = normalizedPath.split("/").filter(Boolean).at(-1) ?? "";
    const { name, extension } = parseFileEntryName(entryName);
    return new File(new Directory(segments.slice(0, -1)), name, extension);
  }
}

export {
  Directory,
  File,
};