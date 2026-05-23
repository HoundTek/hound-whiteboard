import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const verifyModuleUrl = pathToFileURL(path.resolve(currentDir, "../ipc/verify.js")).href;

describe("safe-io verify 运行时行为", () => {
  test("导入 verify 模块不会阻塞进程退出", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(verifyModuleUrl)}).then(() => console.log("verify-loaded"))`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 1500,
      }
    );

    expect(output).toContain("verify-loaded");
  });
});