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
  if (!bridge || typeof bridge.call !== "function") {
    throw new Error("Renderer io bridge is unavailable. Did preload-io.js load?");
  }
  return bridge;
}

function serializeIOValue(value) {
  if (value instanceof Directory) {
    return {
      __houndType: "Directory",
      paths: [...value.paths],
    };
  }

  if (value instanceof File) {
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

async function callIOMethod(target, method, args = []) {
  const result = await getBridge().call({
    target: serializeIOValue(target),
    method,
    args: serializeIOValue(args),
  });
  return deserializeIOValue(result);
}

class Directory {
  paths = [];

  constructor(address, name) {
    if (Array.isArray(address)) {
      this.paths = [...address];
      return;
    }
    const dirPath = name === undefined ? address : joinPathSegments([...splitPathSegments(address), name]);
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

  getPath() {
    return joinPathSegments(this.paths);
  }

  cd(pathStr) {
    return new Directory([...this.paths, ...splitPathSegments(pathStr).filter((segment, index) => !(index === 0 && (segment === "/" || segment.endsWith(":\\"))))]);
  }

  father() {
    return new Directory(this.paths.slice(0, -1));
  }

  peek(fileName, fileExt) {
    return new File(this, fileName, fileExt);
  }

  existDir(dirName) {
    return this.cd(dirName).exist();
  }

  existFile(fileName, fileExt) {
    return this.peek(fileName, fileExt).exist();
  }

  async exist() {
    return callIOMethod(this, "exist");
  }

  async make() {
    const updatedDirectory = await callIOMethod(this, "make");
    this.paths = [...updatedDirectory.paths];
    return this;
  }

  async existOrMake() {
    const updatedDirectory = await callIOMethod(this, "existOrMake");
    this.paths = [...updatedDirectory.paths];
    return this;
  }

  async cp(dest) {
    return callIOMethod(this, "cp", [dest]);
  }

  async rm() {
    await callIOMethod(this, "rm");
    return this;
  }

  async rmWhenExist() {
    await callIOMethod(this, "rmWhenExist");
    return this;
  }

  async mv(dest) {
    return callIOMethod(this, "mv", [dest]);
  }

  async ls() {
    return callIOMethod(this, "ls");
  }

  async lsDir() {
    return callIOMethod(this, "lsDir");
  }

  async lsFile() {
    return callIOMethod(this, "lsFile");
  }

  async hide() {
    const updatedDirectory = await callIOMethod(this, "hide");
    this.paths = [...updatedDirectory.paths];
    return this;
  }

  async unhide() {
    const updatedDirectory = await callIOMethod(this, "unhide");
    this.paths = [...updatedDirectory.paths];
    return this;
  }

  async compress(file, remove = false) {
    return callIOMethod(this, "compress", [file, remove]);
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

class File {
  dir = new Directory([]);
  name = "";
  extension = "";

  constructor(address, name, extension = "") {
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

  getPath() {
    const filename = this.extension === "" ? this.name : `${this.name}.${this.extension}`;
    return joinPathSegments([...this.dir.paths, filename]);
  }

  unPeek() {
    return new Directory([...this.dir.paths]);
  }

  async cat() {
    return callIOMethod(this, "cat");
  }

  async catJSON() {
    return callIOMethod(this, "catJSON");
  }

  async write(content) {
    await callIOMethod(this, "write", [content]);
    return this;
  }

  async writeJSON(content) {
    await callIOMethod(this, "writeJSON", [content]);
    return this;
  }

  async exist() {
    return callIOMethod(this, "exist");
  }

  async init() {
    await callIOMethod(this, "init");
    return this;
  }

  async existOrInit() {
    await callIOMethod(this, "existOrInit");
    return this;
  }

  async existOrWrite(content) {
    await callIOMethod(this, "existOrWrite", [content]);
    return this;
  }

  async existOrWriteJSON(content) {
    await callIOMethod(this, "existOrWriteJSON", [content]);
    return this;
  }

  toUrl() {
    return (previewScreen.style.background = `url("${this.getPath().replace(/\\/g, "\\\\")}")`);
  }

  async cp(dest) {
    return callIOMethod(this, "cp", [dest]);
  }

  async mv(dest) {
    return callIOMethod(this, "mv", [dest]);
  }

  async rm() {
    await callIOMethod(this, "rm");
    return this;
  }

  async rmWhenExist() {
    await callIOMethod(this, "rmWhenExist");
    return this;
  }

  async hide() {
    const updatedFile = await callIOMethod(this, "hide");
    this.dir = updatedFile.dir;
    this.name = updatedFile.name;
    this.extension = updatedFile.extension;
    return this;
  }

  async unhide() {
    const updatedFile = await callIOMethod(this, "unhide");
    this.dir = updatedFile.dir;
    this.name = updatedFile.name;
    this.extension = updatedFile.extension;
    return this;
  }

  async extract(dir) {
    return callIOMethod(this, "extract", [dir]);
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