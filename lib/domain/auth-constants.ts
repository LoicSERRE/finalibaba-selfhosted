/**
 * Values shared between the auth server code and the login form.
 *
 * Its own module because lib/auth.ts pulls in Prisma and bcrypt, so a client
 * component cannot import from it - and duplicating a string that two sides
 * must agree on is how they quietly stop agreeing.
 */

/**
 * authorize() throws this once the password is verified and the account still
 * needs its second factor. NextAuth v4 turns a thrown authorize() error into
 * `?error=<message>`, which `signIn(..., { redirect: false })` returns as
 * `result.error`, so this is how the form knows to ask for a code.
 *
 * Not a username oracle: it is only reachable with a correct password.
 */
export const TOTP_REQUIRED = "TOTP_REQUIRED";
