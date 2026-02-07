/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@intent/(.*)$': '<rootDir>/src/intent/$1',
    '^@transport/(.*)$': '<rootDir>/src/transport/$1',
    '^@signaling/(.*)$': '<rootDir>/src/signaling/$1',
    '^@capture/(.*)$': '<rootDir>/src/capture/$1',
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main/**',
    '!src/renderer/**',
  ],
};
