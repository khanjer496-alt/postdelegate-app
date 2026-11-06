import { parseCommandLine, UsageError } from './args';
import { CliError, Context, HANDLERS } from './commands';
import { ConfigError } from './config';
import { helpText } from './output';

/** Runs the CLI and returns the process exit code. */
export async function run(argv: string[], ctx: Context): Promise<number> {
  const wantsJson = argv.includes('--json');
  try {
    const parsed = parseCommandLine(argv);

    if (parsed.kind === 'version') {
      ctx.stdout(`${ctx.version}\n`);
      return 0;
    }
    if (parsed.kind === 'help') {
      ctx.stdout(helpText(ctx.version, parsed.topic));
      return 0;
    }

    await HANDLERS[parsed.def.name](ctx, parsed.values, parsed.positionals);
    return 0;
  } catch (err) {
    const exitCode =
      err instanceof CliError
        ? err.exitCode
        : err instanceof UsageError
        ? 2
        : 1;
    const message =
      err instanceof CliError || err instanceof UsageError || err instanceof ConfigError
        ? err.message
        : `Unexpected error: ${(err as Error).message}`;

    ctx.stderr(
      wantsJson
        ? JSON.stringify({ error: { message, exitCode } }) + '\n'
        : `Error: ${message}\n` +
            (err instanceof UsageError ? 'Run "postdelegate help" for usage.\n' : '')
    );
    return exitCode;
  }
}
