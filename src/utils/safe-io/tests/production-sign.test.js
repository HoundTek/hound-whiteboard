import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const signModuleUrl = pathToFileURL(path.resolve(currentDir, "../crypto/sign.js")).href;

const runSignProcess = ({ secret, payload, signatureExpression = "sign(payload)" }) => {
  const env = { ...process.env };

  if (secret == null) {
    delete env.CAPABILITY_SECRET;
  } else {
    env.CAPABILITY_SECRET = secret;
  }

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import { sign, verify } from ${JSON.stringify(signModuleUrl)};
        const payload = ${JSON.stringify(payload)};
        const signature = ${signatureExpression};
        console.log(JSON.stringify({
          signature: sign(payload),
          verified: verify(payload, signature),
        }));
      `,
    ],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    }
  );

  return JSON.parse(output.trim());
};

describe("safe-io 生产环境签名行为", () => {
  test("相同 secret 下签名稳定且可以验证", () => {
    const payload = { id: "token-1", root: "/tmp/a", permissions: 3 };

    const first = runSignProcess({ secret: "prod-secret-a", payload });
    const second = runSignProcess({ secret: "prod-secret-a", payload });

    expect(first.signature).toBe(second.signature);
    expect(first.verified).toBe(true);
    expect(second.verified).toBe(true);
  });

  test("不同 secret 会生成不同签名", () => {
    const payload = { id: "token-2", root: "/tmp/b", permissions: 1 };

    const first = runSignProcess({ secret: "prod-secret-a", payload });
    const second = runSignProcess({ secret: "prod-secret-b", payload });

    expect(first.signature).not.toBe(second.signature);
  });

  test("一个 secret 下生成的签名不能在另一个 secret 下通过验证", () => {
    const payload = { id: "token-3", root: "/tmp/c", permissions: 7 };
    const signed = runSignProcess({ secret: "prod-secret-a", payload });

    const verifiedWithAnotherSecret = runSignProcess({
      secret: "prod-secret-b",
      payload,
      signatureExpression: JSON.stringify(signed.signature),
    });

    expect(verifiedWithAnotherSecret.verified).toBe(false);
  });

  test("未设置 secret 时会退回默认开发密钥", () => {
    const payload = { id: "token-4", root: "/tmp/d", permissions: 15 };

    const first = runSignProcess({ secret: null, payload });
    const second = runSignProcess({ secret: undefined, payload });

    expect(first.signature).toBe(second.signature);
    expect(first.verified).toBe(true);
  });
});