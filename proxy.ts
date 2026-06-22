import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token }) => {
      if (process.env.AUTH_ENABLED !== "true") return true;
      return !!token;
    },
  },
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|icon\\.svg|manifest\\.json|.*\\.(?:png|jpg|ico|webp)).*)",
  ],
};
