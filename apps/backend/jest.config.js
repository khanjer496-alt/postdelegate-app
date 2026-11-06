// Unit tests of the backend and the shared libraries it uses.
// Run from the repository root: pnpm run test:backend
module.exports = {
  displayName: 'backend',
  rootDir: '../..',
  testEnvironment: 'node',
  roots: ['<rootDir>/apps/backend/src', '<rootDir>/libraries'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/apps/backend/tsconfig.spec.json',
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    '^file-type$': '<rootDir>/apps/backend/test/esm-only.stub.js',
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
  },
};
