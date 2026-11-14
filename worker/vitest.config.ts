import { configDefaults, defineConfig } from "vitest/config";

// Vitest runs the Gemini-layer tests. test/messages.test.ts uses node:test and runs
// separately (`npm run test:sms`), so it is left out here.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "test/messages.test.ts"] },
});
