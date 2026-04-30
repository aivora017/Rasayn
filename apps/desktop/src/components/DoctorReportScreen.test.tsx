import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DoctorReportScreen from "./DoctorReportScreen";

describe("DoctorReportScreen", () => {
  it("renders the scaffold header", async () => {
    render(<DoctorReportScreen />);
    expect(await screen.findByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
