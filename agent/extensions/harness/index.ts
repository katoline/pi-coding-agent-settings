import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGitTools } from "./flow/git-tools.ts";
import { registerFlow } from "./flow/register.ts";
import { registerGuards } from "./guards/register.ts";
import { registerInstructions } from "./instructions/register.ts";
import { createRuntime } from "./lib/runtime.ts";
import { registerModels } from "./models/register.ts";
import { registerOutput } from "./output/register.ts";
import { registerSubagent } from "./subagent/register.ts";

/**
 * Pi ハーネスの入口。ルールは、コンテキスト(AGENTS.md)ではなく、ここで登録するフックと
 * ツールで強制する。サブエージェントとして起動されたとき(PI_SUBAGENT=1)も、同じ拡張が
 * 読み込まれ、より厳しい制限が効く。
 */
export default function harness(pi: ExtensionAPI): void {
  const rt = createRuntime();
  registerGuards(pi, rt);
  registerInstructions(pi, rt);
  registerOutput(pi, rt);
  registerModels(pi, rt);
  registerSubagent(pi, rt);
  registerFlow(pi, rt);
  registerGitTools(pi, rt);
}
