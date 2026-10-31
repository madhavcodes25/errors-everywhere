const { createToken, verifyToken, hashPassword } = require("../src/auth");

test("auth issues and verifies a token", () => {
  const token = createToken("priya");
  const payload = verifyToken(token);
  expect(payload.user).toBe("priya");
  expect(payload.expiresAt).toBeGreaterThan(Date.now());
});

test("auth rejects an expired token", () => {
  const token = createToken("priya", { ttlMs: -1000 }); // already expired
  expect(() => verifyToken(token)).toThrow(/expired/);
});

test("auth hashes passwords with a unique salt", () => {
  const a = hashPassword("hunter2");
  const b = hashPassword("hunter2");
  expect(a.hash).not.toBe(b.hash); // unique salts
  expect(a.hash).not.toBe("hunter2"); // never store the plain password
});
