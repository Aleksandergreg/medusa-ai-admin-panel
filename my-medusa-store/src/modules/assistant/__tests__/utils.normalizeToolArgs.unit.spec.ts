import { normalizeToolArgs } from "../utils";

describe("normalizeToolArgs", () => {
  it("adds $ prefix to operators and stringifies fields arrays", () => {
    const input = {
      gt: 5,
      eq: "10",
      fields: ["id", "title", "created_at"],
      nested: { lte: "20", other: "x" },
      limit: "25",
    };
    const out = normalizeToolArgs(input);
    expect(out).toEqual({
      $gt: 5,
      $eq: "10",
      fields: "id,title,created_at",
      nested: { $lte: "20", other: "x" },
      limit: 25,
    });
  });

  it("special-cases abandoned_carts mapping for time and email flags", () => {
    const input = {
      threshold: "2h",
      include_without_email: "true",
    };
    const out = normalizeToolArgs(input, "abandoned_carts");
    expect(out.older_than_minutes).toBe(120);
    expect(out.require_email).toBe(false);
  });
});

