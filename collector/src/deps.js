// Build dependencies[] as an ARRAY of { name, version }.
//
// We read the DECLARED dependencies from package.json (preferred) rather than
// resolved versions from package-lock.json: the demo's dependency-upgrade
// scenario edits package.json without reinstalling, and the diff must show
// the bump. package-lock.json is only used as a fallback when there is no
// package.json. (Arrays, never objects: dots in names like "@scope/pkg"
// would break as MongoDB field names.)

const fs = require("fs");
const path = require("path");

function fromPackageJson(pkg) {
  return Object.entries(pkg.dependencies || {}).map(([name, version]) => ({
    name,
    version: String(version),
  }));
}

function fromLockfile(lock) {
  // lockfileVersion >= 2: packages["node_modules/<name>"]
  if (lock.packages) {
    return Object.entries(lock.packages)
      .filter(([key]) => key.startsWith("node_modules/"))
      .map(([key, value]) => ({ name: key.slice("node_modules/".length), version: String(value.version ?? "unknown") }));
  }
  // lockfileVersion 1: dependencies map
  if (lock.dependencies) {
    return Object.entries(lock.dependencies).map(([name, value]) => ({
      name,
      version: String(value.version ?? "unknown"),
    }));
  }
  return [];
}

function readDependencies(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    return fromPackageJson(JSON.parse(fs.readFileSync(pkgPath, "utf8")));
  }
  const lockPath = path.join(cwd, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    return fromLockfile(JSON.parse(fs.readFileSync(lockPath, "utf8")));
  }
  return [];
}

module.exports = { readDependencies };
