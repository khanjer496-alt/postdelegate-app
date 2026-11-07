import { homedir } from 'os';
import { createInterface } from 'readline';
import pkg from '../package.json';
import { run } from './cli';
import type { Context } from './commands';

/** Prompts on the terminal without echoing, or reads the first line when stdin is piped. */
function readSecret(prompt: string): Promise<string> {
  const { stdin, stderr } = process;

  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: stdin });
      rl.once('line', (line) => {
        rl.close();
        resolve(line);
      });
      rl.once('close', () => resolve(''));
    });
  }

  return new Promise((resolve) => {
    stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stderr.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          stdin.setRawMode(false);
          stderr.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}

const context: Context = {
  env: process.env,
  homedir: homedir(),
  version: pkg.version,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readSecret,
};

run(process.argv.slice(2), context).then((code) => {
  process.exitCode = code;
});
