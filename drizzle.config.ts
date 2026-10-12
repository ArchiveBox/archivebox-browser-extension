import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs src/lib/schema.ts against drizzle/ and writes the
// next migration; models.ts bundles and applies them in order.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/schema.ts',
  out: './drizzle',
});
