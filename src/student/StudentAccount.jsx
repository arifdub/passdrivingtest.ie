/*
  The learner's account menu — the photo in the top-right of every tab, the
  same control the instructor portal has. It replaced the Settings tab, so
  the tab bar has room for Lessons and Messages.
*/

import React from "react";
import { UserCog, UserPlus, Globe } from "lucide-react";
import { useAuth } from "../appAuth";
import { usePlatform } from "../platform";
import { portalsFor } from "../portals";
import { AccountMenu } from "../ui";

export default function StudentAccount({ go }) {
  const { user, profile, signOut, isGuest, exitGuest } = useAuth();
  const { accountRoles, isAdminAccount } = usePlatform();

  const actions = [
    { label: "Profile & settings", icon: UserCog, onClick: () => go({ screen: "profile" }) },
    ...(isGuest ? [{ label: "Create a free account", icon: UserPlus, onClick: exitGuest }] : []),
    { label: "Website", icon: Globe, onClick: () => window.open("/?stay=1", "_blank", "noopener") },
  ];

  return (
    <AccountMenu
      variant="avatar"
      photoUrl={isGuest ? null : profile?.avatar_url}
      email={isGuest ? null : user?.email}
      actions={actions}
      portals={isGuest ? [] : portalsFor({ accountRoles, isAdminAccount, here: "student" })}
      onSignOut={isGuest ? exitGuest : signOut}
    />
  );
}
