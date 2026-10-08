import React from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import InstructorPortal from "../src/instructor/InstructorPortal";
createRoot(document.getElementById("root")).render(
  <InstructorPortal onExitRole={() => {}} />
);
