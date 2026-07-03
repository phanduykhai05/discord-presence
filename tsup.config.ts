import { defineConfig } from 'tsup';

// Single bundled entry. The CLI dispatches every role (install / hook / daemon)
// via subcommands, so the daemon is launched by spawning this same file.
export default defineConfig({
  entry: { vdp: 'bin/vdp.ts' },
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  dts: false,
  shims: false,
});
