import { createBuildService } from "@/build/index.js";
import { runCodegen } from "@/common/codegen.js";
import { LoggerService } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { TelemetryService } from "@/common/telemetry.js";
import type { CliOptions } from "../ponder.js";
import { setupShutdown } from "../utils/shutdown.js";

export async function codegen({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const logger = new LoggerService({
    level: options.logLevel,
    dir: options.logDir,
  });

  const [major, minor, _patch] = process.versions.node.split(".").map(Number);
  if (major < 18 || (major === 18 && minor < 14)) {
    logger.fatal({
      service: "process",
      msg: `Invalid Node.js version. Expected >=18.14, detected ${major}.${minor}.`,
    });
    process.exit(1);
  }

  const metrics = new MetricsService();
  const telemetry = new TelemetryService({ options });
  const common = { options, logger, metrics, telemetry };

  const buildService = await createBuildService({ common });

  const cleanup = async () => {
    await buildService.kill();
    await telemetry.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const buildResult = await buildService.start({ watch: false });

  if (buildResult.status === "error") {
    logger.error({
      service: "process",
      msg: "Failed schema build with error:",
      error: buildResult.error,
    });
    await shutdown({ reason: "Failed schema build", code: 1 });
    return;
  }

  runCodegen({ common, graphqlSchema: buildResult.build.graphqlSchema });

  logger.info({ service: "codegen", msg: "Wrote ponder-env.d.ts" });
  logger.info({ service: "codegen", msg: "Wrote schema.graphql" });

  await shutdown({ reason: "Success", code: 0 });
}
