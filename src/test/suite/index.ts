import * as path from "path";
const Mocha = require("mocha");
import * as fs from "fs";

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 10000 });
  const testsRoot = path.resolve(__dirname, ".");
  const files = fs.readdirSync(testsRoot).filter((f) => f.endsWith(".test.js"));
  for (const f of files) {
    mocha.addFile(path.resolve(testsRoot, f));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
