import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    // Demo mode - block all mutations (Server Actions use POST)
    if (process.env.DEMO_MODE === "true" && req.method !== "GET") {
      return new NextResponse(
        JSON.stringify({ error: "Mode démo - données en lecture seule." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  },
  {
    callbacks: {
      authorized: ({ token }) => {
        if (process.env.AUTH_ENABLED !== "true") return true;
        return !!token;
      },
    },
    pages: { signIn: "/login" },
  }
);

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|icon\\.svg|manifest\\.json|.*\\.(?:png|jpg|ico|webp)).*)",
  ],
};
