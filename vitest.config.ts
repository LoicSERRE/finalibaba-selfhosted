import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // lcov is for SonarQube (sonar.javascript.lcov.reportPaths in
      // sonar-project.properties) - text/json-summary are what
      // `pnpm run test:coverage` was already producing for local/CI use
      // before lcov was added here (see the "Development commands" note in
      // CLAUDE.md about the terminal table's rendering bug - trust the JSON).
      reporter: ["text", "json-summary", "lcov"],
    },
  },
});
