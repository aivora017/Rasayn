import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge.js";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>OK</Badge>);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("variant=danger uses danger token classes", () => {
    render(<Badge variant="danger">expired</Badge>);
    const el = screen.getByText("expired");
    expect(el.className).toMatch(/pc-state-danger/);
  });

  it("default variant is neutral", () => {
    render(<Badge>x</Badge>);
    const el = screen.getByText("x");
    expect(el.className).toMatch(/pc-bg-surface-2/);
  });
});
