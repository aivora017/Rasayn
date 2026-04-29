import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ABHAVerifyModal from "./ABHAVerifyModal";

describe("ABHAVerifyModal", () => {
  it("renders the scaffold header", () => {
    render(<ABHAVerifyModal />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
