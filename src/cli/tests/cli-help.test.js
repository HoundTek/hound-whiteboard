/**
 * @file CLI 帮助与国际化测试
 * @description 验证 help 总览与单命令帮助路由、daemon 子命令帮助、未知主题报错，以及 HWB_LANG/LANG 语言检测。
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";

import { runCli, setupCliTestEnv } from "./cli-test-helper.js";
import { detectLocale } from "../i18n.js";

setupCliTestEnv();

describe("CLI 帮助", () => {
  jest.setTimeout(60000);

  test("help / --help / -h 输出总览（含分组与命令）", async () => {
    const { stdout: helpCmd } = await runCli(["help"]);
    expect(helpCmd).toContain("用法：hwb");
    expect(helpCmd).toContain("daemon 管理：");
    expect(helpCmd).toContain("写命令");
    expect(helpCmd).toContain("add --type");
    const { stdout: dashHelp } = await runCli(["--help"]);
    expect(dashHelp).toBe(helpCmd);
    const { stdout: dashH } = await runCli(["-h"]);
    expect(dashH).toBe(helpCmd);
  });

  test("help <命令> 与 <命令> --help / -h 输出一致的单命令帮助", async () => {
    const { stdout: viaHelp } = await runCli(["help", "add"]);
    expect(viaHelp).toContain("用法：hwb add --type");
    expect(viaHelp).toContain("标志：");
    expect(viaHelp).toContain("--data");
    expect(viaHelp).toContain("示例：");
    const { stdout: viaFlag } = await runCli(["add", "--help"]);
    expect(viaFlag).toBe(viaHelp);
    const { stdout: viaShort } = await runCli(["add", "-h"]);
    expect(viaShort).toBe(viaHelp);
  });

  test("help daemon 列出子命令；daemon <子命令> --help 打子命令帮助", async () => {
    const { stdout: daemonHelp } = await runCli(["help", "daemon"]);
    expect(daemonHelp).toContain("子命令：");
    expect(daemonHelp).toContain("daemon start");
    expect(daemonHelp).toContain("daemon release");
    const { stdout: viaHelp } = await runCli(["help", "daemon", "start"]);
    expect(viaHelp).toContain("用法：hwb daemon start --name");
    expect(viaHelp).toContain("--relay");
    expect(viaHelp).toContain("--resident-chunks");
    const { stdout: viaFlag } = await runCli(["daemon", "start", "--help"]);
    expect(viaFlag).toBe(viaHelp);
  });

  test("未知帮助主题报错退出码 1", async () => {
    await expect(runCli(["help", "nope"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("未知帮助主题：nope"),
    });
    await expect(runCli(["nope", "--help"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("未知帮助主题：nope"),
    });
  });

  test("未知命令打印总览并报错退出码 1", async () => {
    await expect(runCli(["bogus"])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("用法：hwb"),
      stderr: expect.stringContaining("未知命令：bogus"),
    });
  });
});

describe("CLI 国际化", () => {
  jest.setTimeout(60000);

  test("detectLocale：HWB_LANG 优先，zh 前缀中文其余英文", () => {
    expect(detectLocale({ HWB_LANG: "zh_CN" })).toBe("zh-CN");
    expect(detectLocale({ HWB_LANG: "en_US", LANG: "zh_CN.UTF-8" })).toBe("en-US");
    expect(detectLocale({ LANG: "zh_CN.UTF-8" })).toBe("zh-CN");
    expect(detectLocale({ LANG: "zh-Hans" })).toBe("zh-CN");
    expect(detectLocale({ LC_ALL: "zh_TW", LANG: "en_US" })).toBe("zh-CN");
    expect(detectLocale({ LANG: "en_US.UTF-8" })).toBe("en-US");
    expect(detectLocale({})).toBe("en-US");
  });

  test("HWB_LANG=en_US 时帮助与错误消息为英文", async () => {
    const { stdout } = await runCli(["help", "add"], { HWB_LANG: "en_US" });
    expect(stdout).toContain("Usage: hwb add --type");
    expect(stdout).toContain("Flags:");
    expect(stdout).toContain("Examples:");
    await expect(runCli(["add"], { HWB_LANG: "en_US" })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("requires --daemon"),
    });
  });

  test("LANG=en_US.UTF-8 生效；HWB_LANG=zh_CN 覆盖英文 LANG", async () => {
    const { stdout: en } = await runCli(["help"], {
      HWB_LANG: "",
      LC_ALL: "",
      LC_MESSAGES: "",
      LANG: "en_US.UTF-8",
    });
    expect(en).toContain("Usage: hwb");
    const { stdout: zh } = await runCli(["help"], {
      HWB_LANG: "zh_CN",
      LANG: "en_US.UTF-8",
    });
    expect(zh).toContain("用法：hwb");
  });
});
