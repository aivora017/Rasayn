import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Heatmap } from "./Heatmap.js";

describe("Heatmap", () => {
  it("renders cells with role=img and aria-label", () => {
    const { container, getByRole } = render(
      <Heatmap cells={["ok", "warn", "danger", "muted"]} cols={2} ariaLabel="x" />,
    );
    expect(getByRole("img", { name: "x" })).toBeInTheDocument();
    expect(container.querySelectorAll("span[aria-hidden]").length).toBe(4);
  });
});
