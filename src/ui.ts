import pc from 'picocolors';

export const ui = {
  /** Bold cyan heading. */
  title: (s: string) => pc.bold(pc.cyan(s)),
  /** Success text (green). */
  ok: (s: string) => pc.green(s),
  /** Error text (red). */
  err: (s: string) => pc.red(s),
  /** Warning / attention text (yellow). */
  warn: (s: string) => pc.yellow(s),
  /** Accent for values, commands, URLs (cyan). */
  accent: (s: string) => pc.cyan(s),
  /** Secondary / muted text (dim). */
  dim: (s: string) => pc.dim(s),
  /** Emphasis (bold). */
  bold: (s: string) => pc.bold(s),

  /** Green check glyph. */
  check: pc.green('✓'),
  /** Red cross glyph. */
  cross: pc.red('✗'),
  /** Muted bullet glyph. */
  bullet: pc.dim('•'),
};
