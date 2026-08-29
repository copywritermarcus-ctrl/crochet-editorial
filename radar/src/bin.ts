import { main } from './cli.js';

main(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'cli.fatal', message }) + '\n',
    );
    process.exitCode = 1;
  },
);
