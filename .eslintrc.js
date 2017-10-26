module.exports = {
  extends: 'airbnb/base',
  env: { mocha: true },
  rules: {
    'comma-dangle': ['error', 'never'],
    'function-paren-newline': 'off',
    'max-len': ['error', 117, 2],
    'no-confusing-arrow': ['error', { allowParens: true }],
    'no-console': 'off',
    'no-return-assign': ['error', 'except-parens']
  },
  globals: { expect: true }
};
