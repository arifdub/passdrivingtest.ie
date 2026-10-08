/* Preview only. Replaces src/platform. */
import React from "react";
export const usePlatform = () => ({
  accountRoles: ["instructor"],
  isAdminAccount: false,
  hasAccountRole: () => true,
  mayUseInstructor: true,
  mayUseStudent: true,
});
export default function PlatformProvider({ children }) { return <>{children}</>; }
