import React from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import BookSheet from "../src/BookSheet";
createRoot(document.getElementById("root")).render(
  <BookSheet
    instructor={{
      user_id: "i1", full_name: "Arif Mahmood",
      lesson_types: ["edt","pretest","mock","refresher","test-day"],
      hourly_rate_cents: 4500, edt_rate_cents: 4000,
    }}
    onClose={() => {}} onBooked={() => {}}
  />
);
