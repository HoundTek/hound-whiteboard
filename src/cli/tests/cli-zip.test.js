/**
 * @file CLI .hwb 打包端到端测试
 * @description 验证导出/导入契约：zip 平铺内容、格式版本校验、目标目录冲突与导入后可持板。
 * @author Zhou Chenyu
 */

import fs from "node:fs/promises";
import path from "node:path";
import { jest } from "@jest/globals";
import AdmZip from "adm-zip";

import {
  runCli,
  runCliJson,
  setupCliTestEnv,
  startTestDaemon,
  STROKE_DATA,
  tempBoardDir,
} from "./cli-test-helper.js";

setupCliTestEnv();

describe("CLI .hwb 打包", () => {
  jest.setTimeout(60000);

  /** 建一块含一个对象的板，返回 {dir, daemon, hwb} */
  async function setupBoard() {
    const { dir, cleanup } = tempBoardDir();
    const hwb = path.join(dir, "..", "board.hwb");
    await runCli(["create", "--path", dir, "--chunk-width", "800", "--chunk-height", "600"]);
    const daemon = await startTestDaemon("zip-test", dir, { source: "cli" });
    await runCli([
      "add",
      "--daemon",
      "zip-test",
      "--type",
      "CircleObject",
      "--data",
      "{radius: 20}",
    ]);
    return { dir, daemon, hwb, cleanup };
  }

  test("export 导出平铺 zip：board.json 在根，排除 .daemon.json", async () => {
    const { dir, daemon, hwb, cleanup } = await setupBoard();
    try {
      await runCli(["export", "--path", dir, "--out", hwb]);
      const zip = new AdmZip(hwb);
      const names = zip.getEntries().map((e) => e.entryName);
      expect(names).toContain("board.json");
      expect(names.some((n) => n.startsWith("objects/"))).toBe(true);
      expect(names.some((n) => n.startsWith("hit/"))).toBe(true);
      expect(names).not.toContain(".daemon.json");
      // board.json 含格式版本与板配置
      const meta = JSON.parse(zip.readAsText("board.json"));
      expect(meta.formatVersion).toBe(1);
      expect(meta.boardConfig).toEqual({ width: 800, height: 600 });
    } finally {
      await daemon.close();
      cleanup();
    }
  });

  test("import 到新目录：对象与记录完整，且可被 daemon 持有", async () => {
    const { dir, daemon, hwb, cleanup } = await setupBoard();
    const target = path.join(dir, "..", "imported");
    try {
      await runCli(["export", "--path", dir, "--out", hwb]);
      await daemon.close();

      await runCli(["import", hwb, "--path", target]);
      const info = await runCliJson(["info", "--path", target]);
      expect(info.objects).toBe(1);
      expect(info.records).toBe(1);
      const listed = await runCliJson(["list", "--path", target]);
      expect(listed.objects[0].type).toBe("CircleObject");

      // 导入后的板可被 daemon 持有
      const daemon2 = await startTestDaemon("zip-imported", target, {
        source: "cli",
      });
      try {
        const { stdout: id } = await runCli([
          "add",
          "--daemon",
          "zip-imported",
          "--type",
          "CircleObject",
          "--data",
          "{radius: 5}",
        ]);
        expect(id.trim()).toBe("cli/2");
      } finally {
        await daemon2.close();
      }
    } finally {
      if (daemon) await daemon.close();
      cleanup();
    }
  });

  test("import 校验：非 zip、缺 board.json、目标非空均报错", async () => {
    const { dir, daemon, hwb, cleanup } = await setupBoard();
    try {
      await runCli(["export", "--path", dir, "--out", hwb]);

      // 非 zip
      const bad = path.join(dir, "..", "bad.hwb");
      await fs.writeFile(bad, "not a zip");
      await expect(
        runCli(["import", bad, "--path", path.join(dir, "..", "t1")]),
      ).rejects.toThrow("不是合法 zip");

      // 缺 board.json 的 zip
      const noMeta = path.join(dir, "..", "nometa.hwb");
      const emptyZip = new AdmZip();
      emptyZip.addFile("objects/1.json", Buffer.from("{}"));
      emptyZip.writeZip(noMeta);
      await expect(
        runCli(["import", noMeta, "--path", path.join(dir, "..", "t2")]),
      ).rejects.toThrow("缺少 board.json");

      // 目标非空
      await expect(
        runCli(["import", hwb, "--path", dir]),
      ).rejects.toThrow("目标目录非空");

      // 版本不兼容
      const oldMeta = new AdmZip();
      oldMeta.addFile(
        "board.json",
        Buffer.from(JSON.stringify({ formatVersion: 99 })),
      );
      oldMeta.writeZip(path.join(dir, "..", "old.hwb"));
      await expect(
        runCli(["import", path.join(dir, "..", "old.hwb"), "--path", path.join(dir, "..", "t3")]),
      ).rejects.toThrow("格式版本不兼容");
    } finally {
      await daemon.close();
      cleanup();
    }
  });

  test("export 不存在板报错", async () => {
    const { dir, cleanup } = tempBoardDir();
    try {
      await expect(
        runCli(["export", "--path", dir, "--out", path.join(dir, "x.hwb")]),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      cleanup();
    }
  });
});
