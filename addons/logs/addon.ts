// Built-in addon: the connector type "file-logs", plain-text log files with one
// event per line starting with an ISO 8601 timestamp.
import { resolve } from "node:path";
import { z } from "zod";
import { defineAddon } from "../../src/addons/types.ts";
import { fileLogs } from "./fileLogs.ts";

export default defineAddon({
  apiVersion: 1,
  personalData: "possible",
  connectors: {
    "file-logs": {
      options: z.object({ path: z.string().min(1) }),
      create: ({ id, description, path }, { workspace }) =>
        fileLogs({ id, description, path: resolve(workspace, String(path)) }),
    },
  },
});
