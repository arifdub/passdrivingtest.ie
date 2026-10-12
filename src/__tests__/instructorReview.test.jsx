/*
  The reviewer's shortcut to the RSA register.

  The register has no deep-linkable search — it filters in the page as you
  type rather than putting the query in the URL (confirmed by the person
  actually using it, not assumed), so there is no address that reliably
  opens straight to one result. This link carries a `?search=` guess on the
  chance the widget reads one on load, but the one thing that has to be
  true regardless of whether that guess pays off is that the link always
  opens the real RSA page — a wrong guess should degrade to "the right
  page, not pre-filled", never to a dead or wrong link.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("../appAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));

const { ReviewCard } = await import("../admin/InstructorReview");

const row = (over = {}) => ({
  user_id: "u1",
  full_name: "Babar Nadeem",
  adi_number: "42013",
  status: "pending",
  ...over,
});

describe("the RSA register shortcut", () => {
  it("links to the real RSA page", () => {
    const html = renderToString(
      <ReviewCard row={row()} queue="pending" onDone={() => {}} />,
    );
    expect(html).toContain(
      "https://www.rsa.ie/services/learner-drivers/driving-lessons/find-an-instructor/approved-driving-instructor",
    );
  });

  it("carries the instructor's name as the search guess, URL-encoded", () => {
    const html = renderToString(
      <ReviewCard row={row({ full_name: "Seán Ó Briain" })} queue="pending" onDone={() => {}} />,
    );
    /* encodeURIComponent, not a raw space or fada — a raw space in an href
       is the kind of thing that works by accident in one browser and
       breaks in another. */
    expect(html).toContain(encodeURIComponent("Seán Ó Briain"));
    expect(html).not.toContain("Seán Ó Briain?search=Seán");
  });

  it("opens in a new tab rather than leaving the review queue", () => {
    const html = renderToString(
      <ReviewCard row={row()} queue="pending" onDone={() => {}} />,
    );
    expect(html).toContain('target="_blank"');
    /* noopener: the new tab is a real government site Claude/this app does
       not control, and must not get a handle back on the admin's own
       window. */
    expect(html).toContain("noopener");
  });

  it("does not offer a link with no name to search for", () => {
    const html = renderToString(
      <ReviewCard row={row({ full_name: null })} queue="pending" onDone={() => {}} />,
    );
    expect(html).not.toContain("rsa.ie");
  });
});
