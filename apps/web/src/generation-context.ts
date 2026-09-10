import type { ProjectSnapshot, Shot } from "@takeboard/contracts";
import type { DemoPayload } from "./api";

export type GenerationContext = {
  snapshot: ProjectSnapshot | null;
  selectedShot: Shot | null;
  projectKey: string | null;
  projectMode: "demo" | "project";
  visible: boolean;
  canEdit: boolean;
  readDocument: () => DemoPayload | null;
  acceptPayload: (payload: DemoPayload) => boolean;
  onError: (message: string | null) => void;
  onNotice: (message: string) => void;
};
