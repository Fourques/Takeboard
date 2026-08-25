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
  defaultAspectRatio?: AspectRatio;
  createStarterShot?: boolean;
  sceneTitle?: string;
  firstShotIntent?: string;
  now?: Date;
};

export class ProjectService {
  async create(
    input: CreateProjectInput,
  ): Promise<{ revision: number; snapshot: ProjectSnapshot }> {
    const now = input.now ?? new Date();
    const timestamp = toIsoTimestamp(now);
    const milliseconds = now.getTime();
    const projectId = createTakeBoardId("project", milliseconds);
    const sceneId = createTakeBoardId("scene", milliseconds);
    const shotId = createTakeBoardId("shot", milliseconds);
    const defaultAspectRatio = input.defaultAspectRatio ?? "16:9";
    const createStarterShot = input.createStarterShot ?? false;
    const snapshot = projectSnapshotSchema.parse({
      schemaVersion,
      exportedAt: timestamp,
      project: {
        id: projectId,
        schemaVersion,
        title: input.title,
        // Kept as a file-format fallback for older snapshots. New projects set
        // framing on each shot instead of asking for a project-wide format.
        defaultAspectRatio,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      scenes: [
        {
          id: sceneId,
          projectId,
          label: "SC-01",
          title: input.sceneTitle?.trim() || "工作画板",
          order: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      textItems: [],
      entities: [],
      assets: [],
      shots: createStarterShot
        ? [
            {
              id: shotId,
              projectId,
              sceneId,
              label: "SH-01",
              order: 0,
              intent: input.firstShotIntent?.trim() || "",
              durationSeconds: 5,
              aspectRatio: defaultAspectRatio,
              workflowPath: null,
              status: "draft",
              approvedTakeId: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]
        : [],
      runs: [],
      takes: [],
      approvals: [],
      canvasItems: createStarterShot
        ? [
            {
              id: createTakeBoardId("canvas_item", milliseconds),
              sceneId,
              refType: "shot",
              refId: shotId,
              x: 180,
              y: 180,
              width: 280,
              height: 180,
              zIndex: 1,
              parentGroupId: null,
              collapsed: false,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]
        : [],
      canvasEdges: [],
    });

    const store = await ProjectStore.open(input.projectDirectory);
    try {
      if (store.loadCurrent()) {
        throw new Error("The selected .takeboard directory already contains a project");
      }
      return await store.save(snapshot, { type: "project.created" });
    } finally {
      store.close();
    }
  }

  async open(projectDirectory: string) {
    const store = ProjectStore.openExisting(projectDirectory);
    if (!store) return null;
    try {
      return store.loadCurrent();
    } finally {
      store.close();
    }
  }
}
