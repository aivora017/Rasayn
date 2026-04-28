import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Illustration } from "./Illustration.js";

describe("Illustration", () => {
  it.each([
    "empty-bills",
    "empty-inventory",
    "empty-customers",
    "empty-search",
    "x1-gmail",
    "x2-image",
    "x3-photo-bill",
    "shop-mascot",
  ] as const)("renders %s with role=img + aria-label", (name) => {
    const { getByRole } = render(<Illustration name={name} ariaLabel={`${name}-art`} />);
    expect(getByRole("img", { name: `${name}-art` })).toBeInTheDocument();
  });
});
