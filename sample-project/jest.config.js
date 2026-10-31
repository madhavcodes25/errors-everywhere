// Jest configuration for shop-api.
// setup.js loads .env so the config test can detect missing variables,
// exactly like a real service that fails to boot without its environment.
module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/tests/setup.js"],
};
