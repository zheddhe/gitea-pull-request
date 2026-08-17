import * as path from "path";
import { runTests } from "@vscode/test-electron";

const DEFAULT_VSCODE_TEST_VERSION = "1.133.0";

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    const version = process.env.VSCODE_TEST_VERSION ?? DEFAULT_VSCODE_TEST_VERSION;

    console.log(`Running extension-host tests with VS Code ${version}`);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      version,
      launchArgs: [
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
      ],
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exitCode = 1;
  }
}

main();
