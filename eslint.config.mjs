// Static analysis config for MMOLite.
//
//   npm run lint:js     -- must exit with 0 errors; run before every commit
//
// A meaningful gate, not a style bikeshed. Every rule below can catch code that
// crashes or silently misbehaves at runtime. Formatting rules are deliberately
// absent — this codebase predates any formatter and reflowing it would bury the
// signal in noise.
//
// NOTE: eslint must be run with cwd inside the repo. Outside its base path it
// silently skips files and reports "0 problems", which reads as success.
//
// Rules are listed explicitly rather than extending @eslint/js recommended, so
// this config needs no extra dependency and the gate cannot drift when a
// preset changes.
//
export default [
    {
        ignores: [
            "node_modules/**",
            "build/**",                      // fused LOVE exe + minified server
            "tools/asset-pipeline/output/**",// generated, untracked
            "client/assets/**",
            "**/*.min.js",
            "master-server/public/**",       // browser bundles loaded via <script>
        ],
    },

    {
        // Server: CommonJS on Node.
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                require: "readonly",
                module: "writable",
                exports: "writable",
                process: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                Buffer: "readonly",
                console: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                setImmediate: "readonly",
                queueMicrotask: "readonly",
                URL: "readonly",
                TextEncoder: "readonly",
                TextDecoder: "readonly",
                AbortController: "readonly",
                fetch: "readonly",
                structuredClone: "readonly",
            },
        },
        rules: {
            // --- Correctness: these are the ones that catch real bugs ---
            "no-undef": "error",            // a bare identifier is a ReferenceError in JS
            "no-dupe-keys": "error",        // silently shadowed object values
            "no-dupe-args": "error",
            "no-dupe-class-members": "error",
            "no-duplicate-case": "error",
            "no-unsafe-negation": "error",  // the `!x === y` shape
            "no-self-compare": "error",
            "no-unreachable": "error",
            "no-unreachable-loop": "error", // loop that runs at most once
            // `except-parens` still catches accidental `if (a = b)` while allowing
            // the idiomatic `while ((m = re.exec(s)) !== null)`.
            "no-cond-assign": ["error", "except-parens"],
            // `while (true)` is correct for a heap sink-down and a PoW solver;
            // this variant still flags genuinely constant `if`/`for` conditions.
            "no-constant-condition": ["error", { checkLoops: "allExceptWhileTrue" }],
            "use-isnan": "error",
            "valid-typeof": "error",
            "no-fallthrough": "error",
            "no-sparse-arrays": "error",
            "no-compare-neg-zero": "error",
            "no-async-promise-executor": "error",
            "require-atomic-updates": "error",
            "no-prototype-builtins": "off", // idiomatic here, not a defect

            // --- Style debt, not defects. Muted with reasons. ---
            "no-unused-vars": "off",   // ~hundreds of interface-conformance stubs
            "no-empty": "off",         // explicit "do nothing" catch blocks
            "no-control-regex": "off", // deliberate control chars in sanitisers
        },
    },

    {
        // Tests run under Jest.
        files: ["tests/**/*.js"],
        languageOptions: {
            globals: {
                describe: "readonly", it: "readonly", test: "readonly",
                expect: "readonly", beforeAll: "readonly", afterAll: "readonly",
                beforeEach: "readonly", afterEach: "readonly", jest: "readonly",
            },
        },
    },

    {
        // Browser-side scripts served by the master server.
        files: ["master-server/**/*.js"],
        languageOptions: {
            sourceType: "script",
            globals: {
                window: "readonly", document: "readonly", localStorage: "readonly",
                fetch: "readonly", console: "readonly", alert: "readonly",
                setTimeout: "readonly", setInterval: "readonly", location: "readonly",
            },
        },
    },
];
