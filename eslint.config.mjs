import globals from 'globals';

export default [
  { ignores: ['scripts/vendor/**'] },
  {
    files: ['{app,scripts,shared,tests}/**/*.mjs'],
    rules: {
      'eqeqeq': 'error',
      'no-debugger': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-imports': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-useless-assignment': 'error',
    },
  },
  {
    files: ['app/**/*.mjs'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['{scripts,tests}/**/*.mjs'],
    languageOptions: { globals: globals.nodeBuiltin },
  },
];
