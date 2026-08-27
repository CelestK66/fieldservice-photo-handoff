import assert from "node:assert/strict";
import test from "node:test";
import { decidePhotoHandoff } from "../src/dispatch_decision.js";

test("a completed dispatch with a stored photo needs no technician follow-up", () => {
  const result = decidePhotoHandoff(
    "WO-1842",
    "work-orders/WO-1842/meter.webp",
    "completed",
    true
  );

  assert.equal(result.photoStatus, "uploaded");
  assert.equal(result.technicianFollowUp, "none");
});

test("a missing photo keeps technician follow-up required", () => {
  const result = decidePhotoHandoff(
    "WO-1842",
    "work-orders/WO-1842/meter.webp",
    "completed",
    false
  );

  assert.equal(result.photoStatus, "awaiting_upload");
  assert.equal(result.technicianFollowUp, "required");
});
