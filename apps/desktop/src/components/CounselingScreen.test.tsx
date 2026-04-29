import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CounselingScreen from "./CounselingScreen";

describe("CounselingScreen", () => {
  it("renders the scaffold header", () => {
    render(<CounselingScreen />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
