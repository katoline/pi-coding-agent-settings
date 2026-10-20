import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const harness =
  process.env.PI_HARNESS_HOME ||
  fileURLToPath(new URL("../../", import.meta.url));
const cfg = JSON.parse(
  readFileSync(path.join(harness, "harness.config.json"), "utf8"),
);
const roles = ["scout", "planner", "worker", "reviewer"] as const;
let delegations = 0;
function inside(root: string, target: string) {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith("../") && rel !== ".." && !path.isAbsolute(rel))
  );
}
function resolveTarget(filename: string, root: string) {
  let probe = path.resolve(root, filename);
  const suffix: string[] = [];
  while (!existsSync(probe)) {
    suffix.unshift(path.basename(probe));
    const parent = path.dirname(probe);
    if (parent === probe) throw new Error("Cannot resolve path");
    probe = parent;
  }
  return path.join(realpathSync(probe), ...suffix);
}
function child(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  role?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      signal,
      env: { ...process.env, ...(role ? { PI_HARNESS_ROLE: role } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(
      () => proc.kill("SIGKILL"),
      cfg.timeoutSeconds * 1000,
    );
    proc.stdout.on("data", (data) => {
      output += data;
      if (output.length > 200000) proc.kill();
    });
    proc.stderr.on("data", (data) => {
      output += data;
      if (output.length > 200000) proc.kill();
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(output)
        : reject(new Error(`Exit ${code}: ${output.slice(-20000)}`));
    });
  });
}
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    const readonly =
      process.env.PI_HARNESS_ROLE === "reviewer" ||
      process.env.PI_HARNESS_ROLE === "scout" ||
      process.env.PI_HARNESS_ROLE === "planner";
    const allowed = [
      "read",
      "grep",
      "find",
      "ls",
      ...(readonly
        ? []
        : ["write", "edit", "harness_delegate", "harness_check"]),
    ];
    if (!allowed.includes(event.toolName))
      return {
        block: true,
        reason:
          "Use the restricted harness tools; raw shell and Git writes are disabled.",
      };
    if (event.toolName === "write" || event.toolName === "edit") {
      try {
        const target = resolveTarget(
          String(event.input.path),
          realpathSync(ctx.cwd),
        );
        const relative = path.relative(realpathSync(ctx.cwd), target);
        if (
          !inside(realpathSync(ctx.cwd), target) ||
          relative.split(path.sep).includes(".git")
        )
          return {
            block: true,
            reason: "Path outside writable project or inside Git metadata",
          };
      } catch {
        return { block: true, reason: "Path cannot be safely resolved" };
      }
    }
    return undefined;
  });
  pi.registerTool({
    name: "harness_delegate",
    label: "Delegate",
    description:
      "Run an independent read-only scout, planner or reviewer. Select the role based on task risk. No recursive delegation.",
    parameters: Type.Object({
      role: Type.Union([
        Type.Literal("scout"),
        Type.Literal("planner"),
        Type.Literal("reviewer"),
      ]),
      task: Type.String(),
    }),
    async execute(_id, params, signal, _update, ctx) {
      if (process.env.PI_HARNESS_ROLE)
        throw new Error("Nested delegation is disabled");
      if (++delegations > cfg.maxDelegations)
        throw new Error("Delegation budget exhausted; reassess the plan");
      if (!roles.includes(params.role)) throw new Error("Unknown role");
      const instructions = readFileSync(
        path.join(harness, `.pi/agents/${params.role}.md`),
        "utf8",
      );
      const model = cfg.models[params.role];
      // Explicit tool allowlist plus the same extension gate; child inherits container isolation.

      const output = await child(
        "pi",
        [
          "--no-extensions",
          "--no-mcp",
          "--no-skills",
          "--no-prompt-templates",
          "-e",
          path.join(harness, ".pi/extensions/harness.ts"),
          "--no-session",
          "--tools",
          "read,grep,find,ls",
          "--append-system-prompt",
          instructions,
          ...(model ? ["--model", model] : []),
          "-p",
          params.task,
        ],
        ctx.cwd,
        signal,
        params.role,
      );
      return {
        content: [{ type: "text", text: output.slice(-40000) }],
        details: {},
      };
    },
  });
  pi.registerTool({
    name: "harness_check",
    label: "Check",
    description:
      "Run configured quality checks inside the sandbox. Failure must be investigated; do not weaken checks.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal, _update, ctx) {
      let output = "";
      for (const [command, ...args] of cfg.checks)
        output += await child(command, args, ctx.cwd, signal);
      return {
        content: [
          { type: "text", text: output || "All configured checks passed" },
        ],
        details: {},
      };
    },
  });
}
