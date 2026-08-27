export type DispatchStatus = "en_route" | "on_site" | "completed";

export type PhotoHandoff = {
  workOrderId: string;
  assetKey: string;
  photoStatus: "awaiting_upload" | "uploaded";
  dispatchStatus: DispatchStatus;
  technicianFollowUp: "required" | "none";
};

export function decidePhotoHandoff(
  workOrderId: string,
  assetKey: string,
  dispatchStatus: DispatchStatus,
  found: boolean
): PhotoHandoff {
  return {
    workOrderId,
    assetKey,
    photoStatus: found ? "uploaded" : "awaiting_upload",
    dispatchStatus,
    technicianFollowUp: found && dispatchStatus === "completed" ? "none" : "required"
  };
}
