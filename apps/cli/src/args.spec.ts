import { parseCommandLine, UsageError } from './args';

describe('parseCommandLine', () => {
  it('shows help without arguments and for help/--help', () => {
    expect(parseCommandLine([])).toEqual({ kind: 'help', topic: undefined });
    expect(parseCommandLine(['help', 'posts', 'create'])).toEqual({
      kind: 'help',
      topic: 'posts create',
    });
    expect(parseCommandLine(['channels', '--help'])).toEqual({
      kind: 'help',
      topic: 'channels',
    });
  });

  it('recognises the version flags', () => {
    expect(parseCommandLine(['--version'])).toEqual({ kind: 'version' });
    expect(parseCommandLine(['-v'])).toEqual({ kind: 'version' });
  });

  it('parses repeated flags and the posts subcommand', () => {
    const parsed = parseCommandLine([
      'posts',
      'create',
      '--channel',
      'a',
      '--channel=b',
      '--text',
      'Hello',
      '--media',
      './a.png',
      '--media',
      'https://x.test/b.png',
      '--schedule',
      '2026-12-01T09:00:00Z',
      '--json',
    ]);
    expect(parsed.kind).toBe('command');
    if (parsed.kind !== 'command') return;
    expect(parsed.def.name).toBe('posts create');
    expect(parsed.values.channel).toEqual(['a', 'b']);
    expect(parsed.values.media).toEqual(['./a.png', 'https://x.test/b.png']);
    expect(parsed.values.schedule).toBe('2026-12-01T09:00:00Z');
    expect(parsed.values.json).toBe(true);
  });

  it('accepts global flags after the command and the integrations alias', () => {
    const parsed = parseCommandLine([
      'integrations',
      '--api-url',
      'http://localhost:3000/api',
    ]);
    expect(parsed.kind).toBe('command');
    if (parsed.kind !== 'command') return;
    expect(parsed.def.name).toBe('channels');
    expect(parsed.values['api-url']).toBe('http://localhost:3000/api');
  });

  it('collects positionals', () => {
    const parsed = parseCommandLine(['posts', 'delete', 'abc']);
    expect(parsed.kind === 'command' && parsed.positionals).toEqual(['abc']);
  });

  it('rejects unknown commands, options and wrong positionals', () => {
    expect(() => parseCommandLine(['nope'])).toThrow(UsageError);
    expect(() => parseCommandLine(['posts'])).toThrow(/subcommand/);
    expect(() => parseCommandLine(['posts', 'nope'])).toThrow(UsageError);
    expect(() => parseCommandLine(['channels', '--wat'])).toThrow(UsageError);
    expect(() => parseCommandLine(['posts', 'delete'])).toThrow(/arguments/);
    expect(() => parseCommandLine(['upload', 'a', 'b'])).toThrow(UsageError);
    expect(() => parseCommandLine(['--json', 'channels'])).toThrow(/command comes first/);
  });

  it('needs --flag=value for values that start with a dash', () => {
    expect(() =>
      parseCommandLine(['posts', 'create', '--text', '-dash'])
    ).toThrow(UsageError);
    const parsed = parseCommandLine(['posts', 'create', '--text=-dash']);
    expect(parsed.kind === 'command' && parsed.values.text).toEqual(['-dash']);
  });
});
