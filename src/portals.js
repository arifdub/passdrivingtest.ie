/*
  ===========================================================================
  WHICH PORTALS AN ACCOUNT CAN OPEN

  One place, so the instructor header, the admin header and the learner's
  settings cannot disagree about where someone is allowed to go. Each takes
  this list minus whichever one it is, and renders it as links.

  Read from the roles the database returned — accountRoles in platform.jsx —
  not from anything the device remembers. A link here is a claim about what
  an account holds, and the device's copy of that is a preference, not a
  fact. Following a link the account cannot back up lands on the gate, which
  offers to add the side; that is a safe failure, but it is not one worth
  arranging on purpose.
  ===========================================================================
*/

import { GraduationCap, Car, ShieldAlert } from "lucide-react";

export const PORTALS = [
  { id: "student",    href: "/student", label: "Learner app",       icon: GraduationCap },
  { id: "instructor", href: "/adi",     label: "Instructor portal", icon: Car },
  { id: "admin",      href: "/admin",   label: "Admin",             icon: ShieldAlert },
];

/* `here` is the portal doing the asking, so it never links to itself. */
export function portalsFor({ accountRoles = [], isAdminAccount = false, here }) {
  return PORTALS.filter(p => {
    if (p.id === here) return false;
    if (p.id === "admin") return isAdminAccount;
    return accountRoles.includes(p.id);
  });
}
