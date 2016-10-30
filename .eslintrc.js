module.exports = {
  'env': {
    'node': true,
    'es6': true,
  },
  'extends': ['eslint:recommended', 'google'],
  'rules': {
    // Possible Errors
    'no-console': ['off'],
    'valid-jsdoc': ['off'],

    // Stylistic Issues
    'linebreak-style': ['error', 'windows'],
    'max-len': ['warn'],
    'new-parens': ['error'],
    'object-curly-spacing': ['error', 'always'],
    'quotes': ['error', 'single', { 'avoidEscape': true, 'allowTemplateLiterals': true }],
    'require-jsdoc': ['off'],
    'spaced-comment': ['error', 'always', { 'block': { 'exceptions': ['*'], 'balanced': true } }],

    // ECMAScript 6
    'arrow-parens': ['error', 'as-needed', { 'requireForBlockBody': true }],
    'prefer-const': ['error'],
  }
};
