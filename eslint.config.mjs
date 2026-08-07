import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  sonarjs.configs.recommended,
  {
    rules: {
      // Extremely common, idiomatic in JSX for 3-way conditional rendering
      // (`cond ? <A/> : cond2 ? <B/> : <C/>`) - triggers on ~35 instances
      // across this codebase's components, virtually all of them ordinary
      // render branches. Forcing extraction into separate statements would
      // hurt readability far more often than it would help here.
      "sonarjs/no-nested-conditional": "off",
      // Default threshold (15) flags several deliberate, single-pass,
      // already-unit-tested aggregation functions (computeAnalytics,
      // computeDashboard, the markdown export builders) that this session
      // spent real effort extracting into pure, tested lib/ functions -
      // splitting them further purely to satisfy this metric would
      // fragment an audited single source of truth for no correctness
      // benefit. Raised to 20 so genuinely-new overly-complex code still
      // gets flagged; the handful of existing outliers above that are
      // called out with inline disables at their definition instead.
      "sonarjs/cognitive-complexity": ["error", 20],
    },
  },
  {
    files: ["__tests__/**"],
    rules: {
      // Test fixture addresses (e.g. rate-limiter test IPs), not real
      // hardcoded infrastructure.
      "sonarjs/no-hardcoded-ip": "off",
      // auth.test.ts's "correct-horse" fixtures exercise the real
      // authorize() password/bcrypt paths - required test data, not a
      // leaked real credential.
      "sonarjs/no-hardcoded-passwords": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // vitest's coverage output (lcov-report/*.js is vendored third-party
    // report-viewer JS, not our code) - .gitignore already excludes
    // /coverage from version control, but ESLint's flat config doesn't
    // read .gitignore, so it needs its own entry.
    "coverage/**",
  ]),
]);

export default eslintConfig;
