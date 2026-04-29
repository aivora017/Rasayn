import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RxScanModal from "./RxScanModal";

describe("RxScanModal", () => {
  it("renders the scaffold header", () => {
    render(<RxScanModal />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
