/* Preview only. Replaces src/appAuth for the screenshot build so the portal
   can render without a real session. Everything below it — the stores, the
   fetches — is the real thing. */
import React from "react";
export const useAuth = () => ({
  user: { id: "11111111-1111-1111-1111-111111111111", email: "zain@example.com" },
  isGuest: false,
  displayName: "Zain",
  signOut: () => {},
  signIn: async () => ({}),
});
export default function AuthProvider({ children }) { return <>{children}</>; }
