/**
 * Environment every test file gets before it runs.
 *
 * `ENCRYPTION_KEY` is here because `lib/domain/crypto-at-rest.ts` refuses to
 * write a credential with no key rather than silently storing plaintext, which
 * is the behaviour worth keeping: the alternative is an instance that looks
 * encrypted and is not. A fixed, obviously-fake key lets the action tests
 * exercise the real write path instead of mocking the encryption away, so a
 * regression in which column gets encrypted still shows up there.
 *
 * `crypto-at-rest.test.ts` overrides it per test, and one case deletes it
 * outright to pin the refuse-to-write behaviour - so nothing here may be made
 * read-only or non-deletable.
 */
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 42).toString("base64");
