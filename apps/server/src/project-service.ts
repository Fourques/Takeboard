import {
  type AspectRatio,
  type ProjectSnapshot,
  projectSnapshotSchema,
  schemaVersion,
} from "@takeboard/contracts";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import { ProjectStore } from "./storage/project-store.js";

export type CreateProjectInput = {
  projectDirectory: string;
  title: string;
  defaultAspectRatio: AspectRatio;
  now?: Date;
};

export class ProjectService {
  async create(input: CreateProjectInput): Promise<ProjectSnapshot> {
    const now = input.now ?? new Date();
    const timestamp = toIsoTimestamp(now);
    const milliseconds = now.getTime();
    const snapshot = projectSnapshotSchema.parse({
      schemaVersion,
      exportedAt: timestamp,
      project: {
        id: createTakeBoardId("project", milliseconds),
        schemaVersion,
        title: input.title,
        defaultAspectRatio: input.defaultAspectRatio,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      scenes: [],
      textItems: [],
      entities: [],
      assets: [],
      shots: [],
      runs: [],
      takes: [],
      approvals: [],
      canvasItems: [],
      canvasEdges: [],
    });

    const store = await ProjectStore.open(input.projectDirectory);
    try {
      if (store.loadCurrent()) {
        throw new Error("The selected .takeboard directory already contains a project");
      }
      await store.save(snapshot, { type: "project.created" });
      return snapshot;
    } finally {
      store.close();
    }
  }

  async open(projectDirectory: string) {
    const store = await ProjectStore.open(projectDirectory);
    try {
      return store.loadCurrent()?.snapshot ?? null;
    } finally {
      store.close();
    }
  }
}
