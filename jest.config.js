/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!@nestjs/jwt/)'],
  collectCoverageFrom: ['apps/**/*.(t|j)s', 'libs/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  roots: ['<rootDir>/apps/', '<rootDir>/libs/'],
  moduleNameMapper: {
    '^@app/shared(|/.*)$': '<rootDir>/libs/shared/src$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/generated/'],
};
