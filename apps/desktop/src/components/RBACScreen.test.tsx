import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RBACScreen from "./RBACScreen";

describe("RBACScreen", () => {
  it("renders the scaffold header", async () => {
    render(<RBACScreen />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
