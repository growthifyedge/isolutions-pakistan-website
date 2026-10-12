import test from "node:test";
import assert from "node:assert/strict";
import { groupSpecifications } from "../src/lib/specificationGroups.ts";

test("groups specs by section in display order without dropping rows", () => {
  const rows = [
    { group: "Software", label: "UI", value: "HyperOS" },
    { group: "Display", label: "Refresh Rate", value: "120Hz" },
    { group: null, label: "Misc", value: "x" },
    { group: "display", label: "Screen Size", value: "6.88 inches" },
    { group: "Custom", label: "A", value: "b" },
  ];
  const groups = groupSpecifications(rows);
  assert.deepEqual(groups.map((g) => g.title), ["Display", "Software", "Custom", "Other"]);
  assert.equal(groups.flatMap((g) => g.rows).length, rows.length);
  assert.deepEqual(groups[0].rows.map((r) => r.label), ["Refresh Rate", "Screen Size"]);
});

test("empty input yields no groups", () => {
  assert.deepEqual(groupSpecifications([]), []);
});
