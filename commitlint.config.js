/**
 * Commitlint configuration.
 *
 * Enforced via husky's commit-msg hook once the toolchain is wired
 * (Phase 1). Until then, this file documents the intended rules and can
 * be run manually:
 *
 *   npx commitlint --from HEAD~1 --to HEAD --verbose
 *
 * See docs/conventions/commits.md for the full convention.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [1, 'always', 72],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'docs',
        'test',
        'perf',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-full-stop': [2, 'never', '.'],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
};
