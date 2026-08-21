// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarBuildIdentity } from "./SidebarBuildIdentity";

afterEach(cleanup);

describe("SidebarBuildIdentity", () => {
  it("renders nothing for an installed build", () => {
    render(<SidebarBuildIdentity build={null} />);

    expect(screen.queryByTestId("sidebar-build-identity")).toBeNull();
  });

  it("keeps the sha visible while the branch is independently truncatable", () => {
    render(
      <SidebarBuildIdentity
        build={{
          branch: "feat/a-very-long-branch-name",
          commit: "e6f422ef5c1a9d3b7f0e2a4c8d1b6e9f3a5c7d20",
          shortCommit: "e6f422e",
          dirty: true,
        }}
      />,
    );

    const identity = screen.getByTestId("sidebar-build-identity");
    expect(identity.textContent).toBe("feat/a-very-long-branch-name@e6f422e•");
    expect(identity.title).toBe(
      "feat/a-very-long-branch-name@e6f422ef5c1a9d3b7f0e2a4c8d1b6e9f3a5c7d20 (dirty)",
    );
    expect(identity.querySelector(".truncate")?.textContent).toBe(
      "feat/a-very-long-branch-name",
    );
    expect(identity.classList.contains("-mx-2")).toBe(true);
    expect(identity.classList.contains("border-y")).toBe(true);
    expect(identity.querySelector(".shrink-0")?.textContent).toBe("@e6f422e•");
    expect(identity.querySelector("button, a, [tabindex]")).toBeNull();
  });
});
