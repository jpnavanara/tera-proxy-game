module.exports = {
  'env': {
    'node': true,
    'es6': true,
  },
  'extends': ['eslint:recommended', 'airbnb-base'],
  'rules': {
    /* airbnb-base/best-practices */
    // allow function param reassignment (used extensively for optional args)
    'no-param-reassign': ['off'],

    /* airbnb-base/style */
    // allow continue (used in for..of loops)
    'no-continue': ['off'],

    // allow generators and iterators
    'no-restricted-syntax': [
      'error',
      'ForInStatement',
      'LabeledStatement',
      'WithStatement',
    ],
  }
};
